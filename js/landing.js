
function animateLandingStats(){

    const statValues =
        document.querySelectorAll('.landing-stat-value');

    statValues.forEach((el, index) => {

        const finalValue =
            parseInt(el.textContent.trim(), 10);

        el.textContent = '0';

        const duration = 1400;
        const start = performance.now();
        const delay = index * 120;

        el.parentElement.style.opacity = '0';
        el.parentElement.style.transform =
            'translateY(12px)';

        setTimeout(() => {

            el.parentElement.style.transition =
                'opacity 0.5s ease, transform 0.5s ease';

            el.parentElement.style.opacity = '1';

            el.parentElement.style.transform =
                'translateY(0px)';

            function animate(now){

                const progress = Math.min(
                    (now - start) / duration,
                    1
                );

                const eased =
                    1 - Math.pow(1 - progress, 3);

                const current =
                    Math.floor(eased * finalValue);

                el.textContent =
                    current.toLocaleString();

                if(progress < 1){
                    requestAnimationFrame(animate);
                }
            }

            requestAnimationFrame(animate);

        }, delay);

    });

}

function renderLandingOverview(){

    const panel = document.getElementById('detailsPanel');

    const total = Object.keys(datasetDB).length;
    let lastUpdated = 'Unknown';

        if(window.archiveLastModified){

            const t = new Date(window.archiveLastModified);

            lastUpdated = t.toLocaleString([],{
                year:'numeric',
                month:'short',
                day:'numeric',
                hour:'2-digit',
                minute:'2-digit'
            });
        }

    const nPolarimetric =
        Object.values(datasetDB)
            .filter(d => d.dataset_type === 'polarimetric')
            .length;

    const nSpectrometric =
        Object.values(datasetDB)
            .filter(d => d.dataset_type === 'spectrometric')
            .length;

    const nContext =
        Object.values(datasetDB)
            .filter(d => d.is_context_imager)
            .length;

    panel.innerHTML = `

    <div class="landing-hero">

        <!-- ===================================== -->
        <!-- BACKGROUND IMAGE -->
        <!-- ===================================== -->

        <div class="landing-image"></div>

        <!-- Dark gradient overlay -->
        <div class="landing-overlay"></div>

        <!-- Animated atmospheric glow -->
        <div class="landing-glow"></div>
        <div class="solar-horizon-glow"></div>

        <div class="solar-arc-container">

            <svg
                class="solar-arc-svg"
                viewBox="0 0 600 320"
            >

                <!-- soft atmospheric arc -->
                <path
                    d="M40 260 Q300 90 560 260"
                    class="solar-arc-blur"
                />

                <path
                    id="solarArcPath"
                    d="M40 260 Q300 90 560 260"
                    class="solar-arc-line"
                />

                <!-- large ambient glow -->
                <circle
                    id="solarGlowLarge"
                    cx="300"
                    cy="120"
                    r="42"
                    class="solar-glow-large"
                />

                <!-- inner glow -->
                <circle
                    id="solarGlow"
                    cx="300"
                    cy="120"
                    r="22"
                    class="solar-glow"
                />

                <!-- actual sun -->
                <circle
                    id="solarPosition"
                    cx="300"
                    cy="120"
                    r="8"
                    class="solar-position"
                />

            </svg>

        </div>

        <!-- ===================================== -->
        <!-- MAIN HERO CONTENT -->
        <!-- ===================================== -->
        <div class="landing-content-shell">
            <div class="landing-content">

                <div class="landing-kicker">
                    DKIST DATASET ARCHIVE
                </div>

                <div class="landing-title">
                    Cryo-NIRSP Archive Browser
                </div>

                <div class="landing-subtitle">

                    Explore Cryo-NIRSP observations,
                    solar footprints, context imagery,
                    spectropolarimetric datasets,
                    and observing campaigns from DKIST.

                </div>

                <!-- ================================= -->
                <!-- ACTION BUTTON -->
                <!-- ================================= -->

                <div class="landing-actions">

                    <button
                        class="explore-btn"
                        onclick="enterArchive()"
                    >
                        Explore Archive
                    </button>

                </div>

            </div>
        </div>

        <!-- ===================================== -->
        <!-- STATS -->
        <!-- ===================================== -->

        <div class="landing-stats">

            <div class="landing-stat-card">

                <div class="landing-stat-label">
                    DATASETS
                </div>

                <div class="landing-stat-value mono">
                    ${total}
                </div>

            </div>

            <div class="landing-stat-card">

                <div class="landing-stat-label">
                    POLARIMETRIC
                </div>

                <div class="landing-stat-value mono">
                    ${nPolarimetric}
                </div>

            </div>

            <div class="landing-stat-card">

                <div class="landing-stat-label">
                    SPECTROMETRIC
                </div>

                <div class="landing-stat-value mono">
                    ${nSpectrometric}
                </div>

            </div>

            <div class="landing-stat-card">

                <div class="landing-stat-label">
                    CONTEXT
                </div>

                <div class="landing-stat-value mono">
                    ${nContext}
                </div>

            </div>

        </div>

        <!-- Footer timestamp -->

        <div class="landing-last-updated">

            Last updated:
            <span class="mono">${lastUpdated}</span>

        </div>

    </div>

`;
initializeSolarArc();
animateLandingStats();
}