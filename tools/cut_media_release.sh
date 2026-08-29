#!/bin/sh
# Cut the media-v2 release: 84 context figures + 84 movies + 84 posters.
# Run from the viewer repo root. ~2.53 GB upload.
set -e
cd /Users/sdash/NSO/Work/Cryo_Datasets/viewer

gh release create media-v2 \
    cn_daily_context_figures/*.jpg \
    cn_daily_movies/*.mp4 \
    cn_daily_movies/*.jpg \
    --repo sr-dash/cryonirsp-media \
    --title "Cryo-NIRSP daily context media" \
    --notes "84 observing dates, 2022-10-18 to 2026-08-13. Regenerated after the DKIST Data Center recalibration. 252 assets: 84 context figures, 84 movies, 84 posters."
