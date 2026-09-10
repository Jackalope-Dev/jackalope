use super::{activate, responses::LIFETIME, Notifications};
use block2::RcBlock;
use objc2::{
    define_class,
    rc::Retained,
    runtime::{Bool, ProtocolObject},
    AnyThread,
};
use objc2_foundation::{NSArray, NSBundle, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
    UNNotificationDefaultActionIdentifier, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::Manager;
use tokio::sync::oneshot;

type Pending = Mutex<HashMap<String, oneshot::Sender<bool>>>;
fn pending() -> &'static Pending {
    static PENDING: OnceLock<Pending> = OnceLock::new();
    PENDING.get_or_init(Pending::default)
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "JackalopeNotificationDelegate"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn present(
            &self,
            _: &UNUserNotificationCenter,
            _: &UNNotification,
            done: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            done.call((
                UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List,
            ));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn respond(
            &self,
            _: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            done: &block2::DynBlock<dyn Fn()>,
        ) {
            let id = response.notification().request().identifier().to_string();
            if let Some(sender) = pending().lock().unwrap().remove(&id) {
                let clicked = unsafe {
                    response.actionIdentifier().as_ref() == UNNotificationDefaultActionIdentifier
                };
                let _ = sender.send(clicked);
            }
            done.call(());
        }
    }
);

fn install() {
    static DELEGATE: OnceLock<Retained<Delegate>> = OnceLock::new();
    DELEGATE.get_or_init(|| {
        let this = Delegate::alloc().set_ivars(());
        let delegate: Retained<Delegate> = unsafe { objc2::msg_send![super(this), init] };
        UNUserNotificationCenter::currentNotificationCenter()
            .setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        delegate
    });
}

struct Notice {
    id: String,
    app: tauri::AppHandle,
}

impl Drop for Notice {
    fn drop(&mut self) {
        pending().lock().unwrap().remove(&self.id);
        let id = self.id.clone();
        let _ = self.app.run_on_main_thread(move || {
            let ids = NSArray::from_retained_slice(&[NSString::from_str(&id)]);
            let center = UNUserNotificationCenter::currentNotificationCenter();
            center.removePendingNotificationRequestsWithIdentifiers(&ids);
            center.removeDeliveredNotificationsWithIdentifiers(&ids);
        });
    }
}

pub async fn show(
    app: &tauri::AppHandle,
    title: &str,
    run_id: Option<String>,
) -> Result<(), String> {
    let (sender, receiver) = oneshot::channel();
    app.run_on_main_thread(move || {
        if NSBundle::mainBundle().bundleIdentifier().is_none() {
            let _ = sender.send(Err("macOS notifications require the installed Jackalope.app bundle."));
            return;
        }
        install();
        let sender = Mutex::new(Some(sender));
        UNUserNotificationCenter::currentNotificationCenter().requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert,
            &RcBlock::new(move |granted: Bool, error: *mut NSError| {
                if let Some(sender) = sender.lock().unwrap().take() {
                    let result = if granted.as_bool() && error.is_null() { Ok(()) }
                        else { Err("Allow Jackalope notifications in macOS System Settings to receive task notices.") };
                    let _ = sender.send(result);
                }
            }),
        );
    }).map_err(|_| "Could not request macOS notification permission.")?;
    tokio::time::timeout(Duration::from_secs(60), receiver)
        .await
        .map_err(|_| {
            "Notification permission is still pending. Try again after responding to macOS."
        })?
        .map_err(|_| "The macOS notification permission request ended unexpectedly.")??;

    let notice = Notice {
        id: uuid::Uuid::new_v4().to_string(),
        app: app.clone(),
    };
    let (response_sender, response) = oneshot::channel();
    pending()
        .lock()
        .unwrap()
        .insert(notice.id.clone(), response_sender);
    let id = notice.id.clone();
    let title = title.to_owned();
    let (sender, receiver) = oneshot::channel();
    app.run_on_main_thread(move || {
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str("Jackalope"));
        content.setBody(&NSString::from_str(&title));
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&id),
            &content,
            None,
        );
        let sender = Mutex::new(Some(sender));
        UNUserNotificationCenter::currentNotificationCenter()
            .addNotificationRequest_withCompletionHandler(
                &request,
                Some(&RcBlock::new(move |error: *mut NSError| {
                    if let Some(sender) = sender.lock().unwrap().take() {
                        let _ = sender.send(error.is_null());
                    }
                })),
            );
    })
    .map_err(|_| "Could not show the macOS notification.")?;
    if !tokio::time::timeout(Duration::from_secs(10), receiver)
        .await
        .map_err(|_| "The macOS notification service did not respond.")?
        .map_err(|_| "The macOS notification request ended unexpectedly.")?
    {
        return Err(
            "macOS could not deliver the notification. Check notification settings.".into(),
        );
    }
    let canceled = app.state::<Notifications>().responses.register();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            result = response => { if result == Ok(true) { activate(&app, run_id); } },
            _ = tokio::time::sleep(LIFETIME) => {},
            _ = canceled => {},
        }
        drop(notice);
    });
    Ok(())
}
