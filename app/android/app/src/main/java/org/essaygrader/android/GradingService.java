package org.essaygrader.android;
import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import java.util.HashSet;
import java.util.Set;

/** User initiated data-sync lease; never restarts or resubmits a paid request. */
public final class GradingService extends Service {
    private final Set<String> tasks=new HashSet<>();
    private PowerManager.WakeLock wakeLock;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final Runnable expiry=()->stopSelf();
    private static final String CHANNEL="essay-grading";
    private static final int NOTIFICATION=4101;
    @Override public void onCreate(){
        super.onCreate();
        if(Build.VERSION.SDK_INT>=26){
            NotificationChannel channel=new NotificationChannel(CHANNEL,"作文批改任务",NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("等待模型结果期间保持任务运行，不显示作文或密钥");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        String token=intent.getStringExtra("token");
        ResultReceiver reply=intent.getParcelableExtra("reply");
        if("end".equals(intent.getAction())){tasks.remove(token);if(tasks.isEmpty())stopSelf();return START_NOT_STICKY;}
        try{
            if(token==null||token.length()>100)throw new IllegalArgumentException();
            tasks.add(token);
            Intent open=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pending=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);
            Notification notification=builder.setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("正在批改作文")
                .setContentText("切换应用后继续等待结果，点击返回查看").setContentIntent(pending).setOngoing(true).setOnlyAlertOnce(true).build();
            if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(NOTIFICATION,notification);
            if(wakeLock==null){wakeLock=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"EssayGrader:grading");wakeLock.setReferenceCounted(false);}
            if(!wakeLock.isHeld())wakeLock.acquire(20*60*1000L);
            handler.removeCallbacks(expiry);handler.postDelayed(expiry,20*60*1000L);
            if(reply!=null)reply.send(1,Bundle.EMPTY);
        }catch(Exception e){if(reply!=null)reply.send(0,Bundle.EMPTY);stopSelf();}
        return START_NOT_STICKY;
    }
    @Override public void onTimeout(int startId,int fgsType){stopSelf();}
    @Override public void onTaskRemoved(Intent rootIntent){stopSelf();}
    @Override public void onDestroy(){handler.removeCallbacks(expiry);if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
