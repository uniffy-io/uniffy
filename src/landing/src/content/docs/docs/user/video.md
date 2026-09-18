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

Your deployment can limit the size and length of videos it converts. An uploaded video outside those limits can still play if your browser supports the original. You can download the original upload to watch with another player.

Playback copies do not grant extra access. An attached video follows access to its note, task, or conversation. If that access is removed, a separate file share or ownership must still allow you to read it. Knowing the video link does not grant permission.
