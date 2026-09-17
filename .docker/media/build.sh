#!/bin/sh
set -eu
export PKG_CONFIG_PATH=/opt/media/lib/pkgconfig
cd /build/ffmpeg
./configure --prefix=/opt/media --extra-cflags=-I/opt/media/include --extra-ldflags=-L/opt/media/lib \
    --disable-everything --disable-autodetect --disable-network --disable-doc --disable-debug \
    --disable-avdevice --disable-shared --enable-static --enable-gpl --enable-libx264 --enable-libdav1d \
    --enable-libzimg --extra-libs='-lstdc++ -lm' --enable-zlib --enable-ffmpeg --enable-ffprobe --pkg-config-flags=--static \
    --enable-protocol=file,pipe \
    --enable-demuxer=mov,matroska,avi,asf,mpegps,mpegts,ogg,flv,image2 \
    --enable-muxer=mp4,image2pipe \
    --enable-decoder=h264,hevc,vp8,vp9,libdav1d,mpeg4,mpeg2video,mpeg1video,msmpeg4v3,h263,vc1,wmv3,wmv2,wmv1,mjpeg,theora,prores,dnxhd,png,aac,mp3,ac3,eac3,mp2,opus,vorbis,flac,alac,wmav2,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_s16be,pcm_alaw,pcm_mulaw \
    --enable-encoder=libx264,aac,png \
    --enable-parser=h264,hevc,vp8,vp9,av1,mpeg4video,mpegvideo,mpegaudio,aac,ac3,mjpeg,opus,vorbis,flac,png \
    --enable-bsf=aac_adtstoasc,extract_extradata \
    --enable-filter=scale,format,transpose,hflip,vflip,aformat,aresample,anull,null,setpts,setsar,zscale,tonemap \
    || { tail -100 ffbuild/config.log; exit 1; }
make -j2
make install
strip /opt/media/bin/ffmpeg /opt/media/bin/ffprobe
mkdir -p /opt/media/share/licenses
cp /build/ffmpeg/COPYING.GPLv2 /opt/media/share/licenses/ffmpeg.txt
cp /build/x264/COPYING /opt/media/share/licenses/x264.txt
cp /build/dav1d/COPYING /opt/media/share/licenses/dav1d.txt
cp /build/zimg/COPYING /opt/media/share/licenses/zimg.txt
/opt/media/bin/ffmpeg -buildconf > /opt/media/share/buildconf.txt 2>&1
