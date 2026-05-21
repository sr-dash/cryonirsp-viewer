// =====================================================
// SOLAR ARC VISUALIZATION
// =====================================================

async function initializeSolarArc(){

    if(!navigator.geolocation) return;

    try{

        navigator.geolocation.getCurrentPosition(position => {

            const lat = position.coords.latitude;
            const lon = position.coords.longitude;

            renderSolarArc(lat, lon);

            setInterval(() => {
                renderSolarArc(lat, lon);
            }, 60000);

        });

    }catch(err){

        console.warn('Solar arc unavailable');
    }
}

// =====================================================
// SOLAR ARC VISUALIZATION
// =====================================================

function renderSolarArc(lat, lon){

    const sun        = document.getElementById('solarPosition');
    const glow       = document.getElementById('solarGlow');
    const glowLarge  = document.getElementById('solarGlowLarge');
    const path       = document.getElementById('solarArcPath');

    if(!sun || !glow || !glowLarge || !path){

        console.warn('Solar arc elements missing');
        return;
    }

    // -------------------------------------------------
    // CURRENT LOCAL TIME
    // -------------------------------------------------

    const now = new Date();

    const hour =
        now.getHours() +
        now.getMinutes() / 60;

    // -------------------------------------------------
    // DAY FRACTION
    // -------------------------------------------------

    const isNight =
        hour < 5 || hour > 19;

    let t =
        (hour - 5) / 14;

    t = Math.max(0, Math.min(1, t));

    // -------------------------------------------------
    // NIGHT POSITION
    // -------------------------------------------------

    if(isNight){

        t = hour < 12
            ? 0.01
            : 0.99;
    }

    // -------------------------------------------------
    // ARC POSITION
    // -------------------------------------------------

    const length =
        path.getTotalLength();

    const point =
        path.getPointAtLength(t * length);

    sun.setAttribute('cx', point.x);
    sun.setAttribute('cy', point.y);

    glow.setAttribute('cx', point.x);
    glow.setAttribute('cy', point.y);

    glowLarge.setAttribute('cx', point.x);
    glowLarge.setAttribute('cy', point.y);

    // -------------------------------------------------
    // SUNSET COLOR SHIFT
    // -------------------------------------------------

    const sunsetFactor =
        Math.abs(t - 0.5) * 2;

    const r = 255;

    const g =
        Math.floor(220 - sunsetFactor * 90);

    const b =
        Math.floor(120 - sunsetFactor * 80);

    const color =
        `rgb(${r},${g},${b})`;

    sun.setAttribute('fill', color);

    // -------------------------------------------------
    // GLOW / VISIBILITY
    // -------------------------------------------------

    if(isNight){

        sun.style.opacity = 0.22;

        glow.style.opacity = 0.06;

        glowLarge.style.opacity = 0.03;

    }else{

        const glowStrength =
            Math.sin(Math.PI * t);

        sun.style.opacity =
            0.65 + 0.35 * glowStrength;

        glow.style.opacity =
            0.25 + 0.45 * glowStrength;

        glowLarge.style.opacity =
            0.10 + 0.20 * glowStrength;
    }
}