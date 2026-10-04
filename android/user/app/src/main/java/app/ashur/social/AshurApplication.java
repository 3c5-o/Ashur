package app.ashur.social;

import android.app.Application;
import android.content.Intent;

import org.json.JSONObject;

import com.onesignal.OneSignal;
import com.onesignal.notifications.INotificationClickEvent;
import com.onesignal.notifications.INotificationClickListener;

public class AshurApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        if (BuildConfig.ONESIGNAL_APP_ID != null && !BuildConfig.ONESIGNAL_APP_ID.isBlank()) {
            OneSignal.initWithContext(this, BuildConfig.ONESIGNAL_APP_ID);
            OneSignal.getNotifications().addClickListener(new INotificationClickListener() {
                @Override
                public void onClick(INotificationClickEvent event) {
                    JSONObject data = event.getNotification().getAdditionalData();
                    Intent intent = new Intent(AshurApplication.this, MainActivity.class);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    if (data != null) {
                        intent.putExtra("ashur_push_data", data.toString());
                    }
                    startActivity(intent);
                }
            });
        }
    }
}
