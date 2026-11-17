package dev.jackalope.companion

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  @Volatile private var insets = "{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0}"

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // Android's WebView reports zero for CSS safe-area insets. The page reads the system bar and
  // cutout sizes from window.JackalopeInsets.get() and listens for "jackalope-insets" changes.
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(object {
      @JavascriptInterface fun get(): String = insets
    }, "JackalopeInsets")
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, windowInsets ->
      val bars = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val density = resources.displayMetrics.density
      insets = "{\"top\":${bars.top / density},\"right\":${bars.right / density}," +
        "\"bottom\":${bars.bottom / density},\"left\":${bars.left / density}}"
      (view as WebView).evaluateJavascript(
        "window.dispatchEvent(new Event('jackalope-insets'))", null
      )
      windowInsets
    }
  }
}
