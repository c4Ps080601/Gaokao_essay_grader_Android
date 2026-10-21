package org.essaygrader.android;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EssayNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
