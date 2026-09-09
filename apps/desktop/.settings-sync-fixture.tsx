import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OnboardingFlow} from './src/components/onboarding/OnboardingFlow';
import {PrivacySettings} from './src/components/settings/PrivacySettings';
import {ArcColorPicker} from './src/components/theme/ArcColorPicker';
import {useSettingsSyncStore,observeSettingsSync} from './src/stores/settingsSyncStore';
import {useSettingsStore} from './src/stores/settingsStore';
import {useThemeStore} from './src/stores/themeStore';
import {useOnboardingStore} from './src/stores/onboardingStore';
import './src/index.css';
import './src/components/settings/settings.css';
import './src/components/ui/experience.css';
window.fixture={account:'disconnected',enabled:true,revision:1,settings:{version:1,accentHex:'#6366f1',isDark:true,appearance:'manual',atmosphere:12,harmony:'single',mascotReactions:true,notifications:'none',osNotifications:true},calls:[],fail:false};
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.syncStore=useSettingsSyncStore;window.settingsStore=useSettingsStore;window.themeStore=useThemeStore;
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>0,unregisterCallback:()=>{},invoke:async(command,args)=>{
 const f=window.fixture;f.calls.push(command+':'+(args?.action?.action??''));
 const status=()=>({state:f.account,email:f.account==='connected'?'fixture@example.invalid':null,userCode:'ABCD1234',expiresAt:Date.now()+600000});
 if(command==='app_execution_access')return {required:true,allowed:f.account==='connected'};
 if(command==='app_account_status'||command==='app_account_poll')return status();
 if(command==='app_account_connect'){f.account='waiting';return status();}
 if(command==='app_account_referrals')return {limit:5,remaining:5,accepted:0,downloaded:0,connected:0,shareUrl:'',invites:[]};
 if(command==='app_community_settings'||command==='app_community_configure')return {reviewed:true,telemetry:false,errors:false,configured:false,buildChannel:'beta'};
 if(command==='app_settings_sync'){
   const a=args.action;const view=()=>({available:true,enabled:f.enabled,owner:f.account==='connected'?'fixture-owner':null,revision:f.revision,settings:f.settings,conflict:false});
   if(a.action==='status')return view();
   if(f.fail)throw Error('Fixture offline');
   if(a.action==='configure'){f.enabled=a.enabled;return view();}
   if(a.action==='delete'){f.enabled=false;f.revision=0;f.settings=null;return view();}
   if(!f.enabled)throw Error('Sync is off');
   if(a.action==='read'&&f.pause){await new Promise(resolve=>window.finishRead=resolve);f.pause=false;}
   if(a.action==='write'){if(a.revision!==f.revision)return {...view(),conflict:true};f.revision++;f.settings=a.settings;}
   return view();
 }
 return null;
}};
function Fixture(){const [settings,showSettings]=useState(false);window.showSettings=()=>showSettings(true);useEffect(observeSettingsSync,[]);return settings?<main style={{padding:32,maxWidth:850,margin:'auto'}}><h1>Privacy</h1><ArcColorPicker/><PrivacySettings/></main>:<OnboardingFlow onFinish={()=>{}} onSkip={()=>{}}/>;}
useOnboardingStore.getState().begin();createRoot(document.getElementById('root')).render(<Fixture/>);