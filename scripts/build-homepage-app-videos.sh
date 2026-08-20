#!/usr/bin/env bash
set -euo pipefail

NUTRITION_SOURCE="/Users/ryansullivan/Downloads/ScreenRecording_07-31-2026 16-38-59_1.MP4"
GUT_SOURCE="/Users/ryansullivan/Downloads/ScreenRecording_07-31-2026 18-06-24_1.MP4"
ADAPTIVE_SOURCE="/Users/ryansullivan/Downloads/ScreenRecording_07-31-2026 16-43-04_1.mov"
MAHI_SOURCE="/Users/ryansullivan/Desktop/Iphone SS/StatsKey Ad Videos/Mahi-Mahi Ad - IMG_6965.MOV"
OUTPUT_DIR="/Users/ryansullivan/Projects/StatsKey Website/public/statskey-app"
POSITIONING_SOURCE="/Users/ryansullivan/Desktop/Iphone SS/App Preview Sources (EN)/03 - Food logging + Nutrition Facts - ScreenRecording_07-12-2026 09-40-01_1.MP4"

for source in "$NUTRITION_SOURCE" "$GUT_SOURCE" "$ADAPTIVE_SOURCE" "$MAHI_SOURCE" "$POSITIONING_SOURCE"; do
  if [[ ! -f "$source" ]]; then
    echo "Missing source recording: $source" >&2
    exit 1
  fi
done

COMMON_VIDEO="scale=660:1434:flags=lanczos,fps=60,setsar=1,format=yuv420p"

# Lead with the full bison and rice nutrient labels, then trace one abnormality
# into its confidence and food-level sourcing. The source breakdown begins below
# the calibration line that contains age and weight.
NUTRITION_FILTER="
[0:v]split=3[bison_in][rice_in][try_in];
[bison_in]trim=start=18.75:end=20.95,setpts=PTS-STARTPTS,$COMMON_VIDEO[bison];
[rice_in]trim=start=22.55:end=24.85,setpts=PTS-STARTPTS,$COMMON_VIDEO[rice];
[try_in]trim=start=71.90:end=75.10,setpts=PTS-STARTPTS,$COMMON_VIDEO[tryptophan];
[bison][rice]xfade=transition=fade:duration=0.18:offset=2.02[bison_rice];
[bison_rice][tryptophan]xfade=transition=fade:duration=0.18:offset=4.14,
fade=t=in:st=0:d=0.14:color=white,
fade=t=out:st=7.18:d=0.14:color=white[nutrition_out]
"

ffmpeg -y -hide_banner -loglevel error \
  -i "$NUTRITION_SOURCE" \
  -filter_complex "$NUTRITION_FILTER" \
  -map "[nutrition_out]" -an \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
  -map_metadata -1 \
  "$OUTPUT_DIR/nutrition-evidence.mp4"

# Market-positioning demo: quick search, review, then the comprehensive nutrient
# panel. All footage is from the same current app recording.
POSITIONING_FILTER="
[0:v]split=3[search_in][review_in][nutrients_in];
[search_in]trim=start=2.00:end=4.80,setpts=PTS-STARTPTS,$COMMON_VIDEO[search];
[review_in]trim=start=9.00:end=11.80,setpts=PTS-STARTPTS,$COMMON_VIDEO[review];
[nutrients_in]trim=start=22.00:end=25.00,setpts=PTS-STARTPTS,$COMMON_VIDEO[nutrients];
[search][review]xfade=transition=fade:duration=0.18:offset=2.62[search_review];
[search_review][nutrients]xfade=transition=fade:duration=0.18:offset=5.24,
fade=t=in:st=0:d=0.14:color=white,
fade=t=out:st=8.06:d=0.14:color=white[positioning_out]
"

ffmpeg -y -hide_banner -loglevel error \
  -i "$POSITIONING_SOURCE" \
  -filter_complex "$POSITIONING_FILTER" \
  -map "[positioning_out]" -an \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
  -map_metadata -1 \
  "$OUTPUT_DIR/positioning-demo.mp4"

# Adaptive planning demo: recent values, the weekly plan, then training-block
# and race-outlook evidence.
ADAPTIVE_FILTER="
[0:v]split=3[recent_in][week_in][outlook_in];
[recent_in]trim=start=0.40:end=3.60,setpts=PTS-STARTPTS,$COMMON_VIDEO[recent];
[week_in]trim=start=6.50:end=10.50,setpts=PTS-STARTPTS,$COMMON_VIDEO[week];
[outlook_in]trim=start=14.00:end=19.10,setpts=PTS-STARTPTS,$COMMON_VIDEO[outlook];
[recent][week]xfade=transition=fade:duration=0.18:offset=3.02[recent_week];
[recent_week][outlook]xfade=transition=fade:duration=0.18:offset=6.84,
fade=t=in:st=0:d=0.14:color=white,
fade=t=out:st=11.76:d=0.14:color=white[adaptive_out]
"

ffmpeg -y -hide_banner -loglevel error \
  -i "$ADAPTIVE_SOURCE" \
  -filter_complex "$ADAPTIVE_FILTER" \
  -map "[adaptive_out]" -an \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
  -map_metadata -1 \
  "$OUTPUT_DIR/adaptive-planner-demo.mp4"

# Gut Check form only: the trim excludes the personalized greeting, dated
# Wellness Journal timeline, appearance, concerns, notes, Control Center, and
# the redundant first second of the form view.
ffmpeg -y -hide_banner -loglevel error \
  -ss 4.55 -t 8.80 -i "$GUT_SOURCE" \
  -map "0:v:0" -an \
  -vf "$COMMON_VIDEO" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
  -map_metadata -1 \
  "$OUTPUT_DIR/gut-check-recording.mp4"

# A single action-focused Mahi-Mahi shot replaces the app montage in the hero.
ffmpeg -y -hide_banner -loglevel error \
  -ss 2.00 -t 12.00 -i "$MAHI_SOURCE" \
  -map "0:v:0" -an \
  -vf "scale=540:960:flags=lanczos,fps=30,setsar=1,format=yuv420p,fade=t=in:st=0:d=0.22:color=white,fade=t=out:st=11.78:d=0.22:color=white" \
  -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart \
  -map_metadata -1 \
  "$OUTPUT_DIR/mahi-mahi-hero.mp4"

ffmpeg -y -hide_banner -loglevel error \
  -ss 0.80 -i "$OUTPUT_DIR/nutrition-evidence.mp4" \
  -frames:v 1 -q:v 2 \
  "$OUTPUT_DIR/nutrition-evidence-poster.jpg"

ffmpeg -y -hide_banner -loglevel error \
  -ss 6.20 -i "$OUTPUT_DIR/positioning-demo.mp4" \
  -frames:v 1 -q:v 2 \
  "$OUTPUT_DIR/positioning-demo-poster.jpg"

ffmpeg -y -hide_banner -loglevel error \
  -ss 7.40 -i "$OUTPUT_DIR/adaptive-planner-demo.mp4" \
  -frames:v 1 -q:v 2 \
  "$OUTPUT_DIR/adaptive-planner-demo-poster.jpg"

ffmpeg -y -hide_banner -loglevel error \
  -ss 8.00 -i "$OUTPUT_DIR/gut-check-recording.mp4" \
  -frames:v 1 -q:v 2 \
  "$OUTPUT_DIR/gut-check-recording-poster.jpg"

ffmpeg -y -hide_banner -loglevel error \
  -ss 6.00 -i "$OUTPUT_DIR/mahi-mahi-hero.mp4" \
  -frames:v 1 -q:v 2 \
  "$OUTPUT_DIR/mahi-mahi-hero-poster.jpg"

echo "Built privacy-safe homepage screen recordings in $OUTPUT_DIR"
