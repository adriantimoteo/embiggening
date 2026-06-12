package com.embiggen.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Capacitor 6 does not automatically call webView.goBack() on the Android
    // back gesture — it fires a JS backButton event instead. Since we have no
    // JS listener for that event, the gesture would do nothing. Override here
    // so the back gesture reliably pops the WebView history (history.pushState
    // entry from navigateToDisplay()), which fires popstate → navigateToHome().
    @Override
    public void onBackPressed() {
        if (getBridge() != null && getBridge().getWebView().canGoBack()) {
            getBridge().getWebView().goBack();
        } else {
            super.onBackPressed();
        }
    }
}
