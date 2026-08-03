package com.uniffy.callservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

// Android stops microphone capture for a backgrounded app unless a foreground
// service of type "microphone" is running, so a call would publish silence the
// moment the user leaves the app - while inbound audio keeps playing and the UI
// shows no error. RECORD_AUDIO is a while-in-use permission, so this service can
// only be started while the app is still foregrounded.
class CallForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    createChannel()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // The call owns this service's lifetime. A restart after process death would
    // show an ongoing-call notification for a room nothing is connected to.
    return START_NOT_STICKY
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel =
      NotificationChannel(CHANNEL_ID, "Ongoing calls", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shown while a Uniffy call is running"
        setShowBadge(false)
        setSound(null, null)
        enableVibration(false)
      }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent =
      launch?.let {
        PendingIntent.getActivity(
          this,
          0,
          it,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
      }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Call in progress")
      .setContentText("Tap to return to the call")
      .setSmallIcon(android.R.drawable.stat_sys_speakerphone)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setShowWhen(false)
      .setContentIntent(contentIntent)
      .build()
  }

  private companion object {
    const val CHANNEL_ID = "uniffy_ongoing_call"
    const val NOTIFICATION_ID = 8401
  }
}
