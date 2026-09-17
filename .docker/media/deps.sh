#!/bin/sh
set -eu
export PKG_CONFIG_PATH=/opt/media/lib/pkgconfig
export CFLAGS='-O2 -fPIC'
export CXXFLAGS='-O2 -fPIC'
mkdir -p /build/ffmpeg /build/x264 /build/dav1d /build/zimg /opt/media/bin
for name in ffmpeg x264 dav1d zimg; do
    tar -xf "/sources/$name.tar" -C "/build/$name" --strip-components=1
done
cd /build/x264
./configure --prefix=/opt/media --enable-static --disable-cli --disable-opencl
make -j2
make install
cd /build/dav1d
meson setup build --prefix=/opt/media --libdir=lib -Ddefault_library=static -Denable_tools=false -Denable_tests=false
ninja -C build -j2
ninja -C build install
cd /build/zimg
./autogen.sh
./configure --prefix=/opt/media --enable-static --disable-shared
make -j2
make install
