#!/bin/bash
# ============================================
# ClipForge Render Script
# Generated: 2026-01-14T18:05:16.943Z
# ============================================
#
# INSTRUCCIONES:
# 1. Coloca este script en la carpeta con tus clips y música
# 2. Clips en: input/clips/0.mp4, 1.mp4, etc.
# 3. Música en: input/music/music.mp3 (si la usas)
# 4. Ejecuta: chmod +x render.sh && ./render.sh
#
# Configuración:
# - Resolución: 1080x1920
# - Aspecto: 9:16
# - FPS: 30
# - Estilo de cortes: fast
# - Transiciones: hard_cut
#
# Requisitos: FFmpeg descargado en ~/Downloads/ffmpeg (evermeet)
# ============================================

set -e

# --- FIX Mac: usar ffmpeg descargado (evita "command not found") ---
FFMPEG="$HOME/Downloads/ffmpeg"

if [ ! -x "$FFMPEG" ]; then
  echo "❌ No encuentro ffmpeg en: $FFMPEG"
  echo "👉 Comprueba con: ls -l ~/Downloads/ffmpeg"
  exit 1
fi

echo "🎬 ClipForge - Iniciando render local..."
echo "📐 Resolución: 1080x1920"
echo "🎯 FPS: 30"
echo ""

# Crear carpetas necesarias
mkdir -p temp_clips
mkdir -p output

# Clip 1: desde 0s hasta 1s (1.0s)
echo "📹 Procesando clip 1/24..."
$FFMPEG -y -ss 0 -i "input/clips/0.mp4" -t 1 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_0.mp4"

# Clip 2: desde 0.5s hasta 1.5s (1.0s)
echo "📹 Procesando clip 2/24..."
$FFMPEG -y -ss 0.5 -i "input/clips/1.mp4" -t 1 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_1.mp4"

# Clip 3: desde 0s hasta 1.2s (1.2s)
echo "📹 Procesando clip 3/24..."
$FFMPEG -y -ss 0 -i "input/clips/2.mp4" -t 1.2 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_2.mp4"

# Clip 4: desde 0.8s hasta 1.8s (1.0s)
echo "📹 Procesando clip 4/24..."
$FFMPEG -y -ss 0.8 -i "input/clips/3.mp4" -t 1 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_3.mp4"

# Clip 5: desde 0s hasta 1s (1.0s)
echo "📹 Procesando clip 5/24..."
$FFMPEG -y -ss 0 -i "input/clips/4.mp4" -t 1 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_4.mp4"

# Clip 6: desde 0.5s hasta 1.5s (1.0s)
echo "📹 Procesando clip 6/24..."
$FFMPEG -y -ss 0.5 -i "input/clips/5.mp4" -t 1 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_5.mp4"

# Clip 7: desde 1s hasta 2.2s (1.2s)
echo "📹 Procesando clip 7/24..."
$FFMPEG -y -ss 1 -i "input/clips/0.mp4" -t 1.2000000000000002 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_6.mp4"

# Clip 8: desde 1.5s hasta 2.7s (1.2s)
echo "📹 Procesando clip 8/24..."
$FFMPEG -y -ss 1.5 -i "input/clips/1.mp4" -t 1.2000000000000002 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_7.mp4"

# Clip 9: desde 1.2s hasta 2.4s (1.2s)
echo "📹 Procesando clip 9/24..."
$FFMPEG -y -ss 1.2 -i "input/clips/2.mp4" -t 1.2 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_8.mp4"

# Clip 10: desde 1.8s hasta 3s (1.2s)
echo "📹 Procesando clip 10/24..."
$FFMPEG -y -ss 1.8 -i "input/clips/3.mp4" -t 1.2 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_9.mp4"

# Clip 11: desde 1s hasta 2.2s (1.2s)
echo "📹 Procesando clip 11/24..."
$FFMPEG -y -ss 1 -i "input/clips/4.mp4" -t 1.2000000000000002 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_10.mp4"

# Clip 12: desde 1.5s hasta 2.7s (1.2s)
echo "📹 Procesando clip 12/24..."
$FFMPEG -y -ss 1.5 -i "input/clips/5.mp4" -t 1.2000000000000002 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_11.mp4"

# Clip 13: desde 2.2s hasta 3.5s (1.3s)
echo "📹 Procesando clip 13/24..."
$FFMPEG -y -ss 2.2 -i "input/clips/0.mp4" -t 1.2999999999999998 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_12.mp4"

# Clip 14: desde 2.7s hasta 4s (1.3s)
echo "📹 Procesando clip 14/24..."
$FFMPEG -y -ss 2.7 -i "input/clips/1.mp4" -t 1.2999999999999998 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_13.mp4"

# Clip 15: desde 2.4s hasta 3.7s (1.3s)
echo "📹 Procesando clip 15/24..."
$FFMPEG -y -ss 2.4 -i "input/clips/2.mp4" -t 1.3000000000000003 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_14.mp4"

# Clip 16: desde 3s hasta 4.3s (1.3s)
echo "📹 Procesando clip 16/24..."
$FFMPEG -y -ss 3 -i "input/clips/3.mp4" -t 1.2999999999999998 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_15.mp4"

# Clip 17: desde 2.2s hasta 3.5s (1.3s)
echo "📹 Procesando clip 17/24..."
$FFMPEG -y -ss 2.2 -i "input/clips/4.mp4" -t 1.2999999999999998 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_16.mp4"

# Clip 18: desde 2.7s hasta 4s (1.3s)
echo "📹 Procesando clip 18/24..."
$FFMPEG -y -ss 2.7 -i "input/clips/5.mp4" -t 1.2999999999999998 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_17.mp4"

# Clip 19: desde 3.5s hasta 5s (1.5s)
echo "📹 Procesando clip 19/24..."
$FFMPEG -y -ss 3.5 -i "input/clips/0.mp4" -t 1.5 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_18.mp4"

# Clip 20: desde 4s hasta 5.5s (1.5s)
echo "📹 Procesando clip 20/24..."
$FFMPEG -y -ss 4 -i "input/clips/1.mp4" -t 1.5 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_19.mp4"

# Clip 21: desde 3.7s hasta 5.2s (1.5s)
echo "📹 Procesando clip 21/24..."
$FFMPEG -y -ss 3.7 -i "input/clips/2.mp4" -t 1.5 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_20.mp4"

# Clip 22: desde 4.3s hasta 5.8s (1.5s)
echo "📹 Procesando clip 22/24..."
$FFMPEG -y -ss 4.3 -i "input/clips/3.mp4" -t 1.5 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_21.mp4"

# Clip 23: desde 3.5s hasta 5s (1.5s)
echo "📹 Procesando clip 23/24..."
$FFMPEG -y -ss 3.5 -i "input/clips/4.mp4" -t 1.5 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_22.mp4"

# Clip 24: desde 4s hasta 5.5s (1.5s)
echo "📹 Procesando clip 24/24..."
$FFMPEG -y -ss 4 -i "input/clips/5.mp4" -t 1.5 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:v libx264 -preset fast -crf 18 \
  -an \
  "temp_clips/segment_23.mp4"

# Crear lista de concatenación
echo "📋 Preparando concatenación..."
cat > temp_clips/concat.txt << 'EOF'
file 'segment_0.mp4'
file 'segment_1.mp4'
file 'segment_2.mp4'
file 'segment_3.mp4'
file 'segment_4.mp4'
file 'segment_5.mp4'
file 'segment_6.mp4'
file 'segment_7.mp4'
file 'segment_8.mp4'
file 'segment_9.mp4'
file 'segment_10.mp4'
file 'segment_11.mp4'
file 'segment_12.mp4'
file 'segment_13.mp4'
file 'segment_14.mp4'
file 'segment_15.mp4'
file 'segment_16.mp4'
file 'segment_17.mp4'
file 'segment_18.mp4'
file 'segment_19.mp4'
file 'segment_20.mp4'
file 'segment_21.mp4'
file 'segment_22.mp4'
file 'segment_23.mp4'
EOF

# Concatenar clips
echo "🔗 Concatenando 24 segmentos..."
$FFMPEG -y -f concat -safe 0 -i temp_clips/concat.txt -c copy temp_clips/video_only.mp4

# Añadir música (FIX: sin ffprobe/bc, para que funcione en tu Mac)
echo "🎵 Añadiendo música (volumen 0.9)..."
$FFMPEG -y -i temp_clips/video_only.mp4 -i "input/music/music.mp3" \
  -filter:a "volume=0.9" \
  -map 0:v -map 1:a \
  -c:v copy -c:a aac -shortest \
  "output/output_final.mp4"

# Limpieza
echo "🧹 Limpiando archivos temporales..."
rm -rf temp_clips

echo ""
echo "✅ ¡Render completado!"
echo "📺 Tu video está en: output/output_final.mp4"
echo ""
