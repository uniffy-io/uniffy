---
title: Video playback
description: What happens when your device cannot play an uploaded video.
sidebar:
  label: Video
  order: 5
---

Uniffy tries your uploaded video first. If your device can play it, playback starts without waiting for conversion.

Some formats need a compatible copy. Uniffy prepares one MP4 in the background and uses it when original playback fails. You may see "Preparing this video. Longer videos can take a few minutes." Conversion must finish before that copy can play. Time depends on video length, server capacity, and other queued work.

Playback copies fit within 1920 by 1080 pixels and retain source frame rate. Smaller videos stay small. Supported HDR videos convert to SDR for wider playback support. Device limits still apply, especially for high frame rates.

Downloads preserve your original upload. Screen recordings are the exception: Uniffy converts its WebM recording into the promised MP4. Download becomes available when that conversion finishes. Devices that understand the recording source can play it earlier.

If conversion fails or your device cannot play either version, download the file to watch with another player. Your access to playback follows the same sharing rules as the file.
