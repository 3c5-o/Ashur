package app.ashur.social;

import android.app.Application;
import com.onesignal.OneSignal;

public class AshurApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        if (BuildConfig.ONESIGNAL_APP_ID != null && !BuildConfig.ONESIGNAL_APP_ID.isBlank()) {
            OneSignal.initWithContext(this, BuildConfig.ONESIGNAL_APP_ID);
        }
    }
}
