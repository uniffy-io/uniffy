package com.uniffy.callservice

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CallForegroundServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CallForegroundService")

    Function("start") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ContextCompat.startForegroundService(
        context,
        Intent(context, CallForegroundService::class.java),
      )
    }

    Function("stop") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      context.stopService(Intent(context, CallForegroundService::class.java))
    }
  }
}
