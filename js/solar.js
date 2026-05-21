function makeSolarFootprint(d){

    try{

        if(!d.spatial_bounds_arcsec)
            return '';

        const xs = d.spatial_bounds_arcsec[0];
        const ys = d.spatial_bounds_arcsec[1];

        if(!xs || !ys)
            return '';

        const rs = d.solar_radius_arcsec || 960;

        const points = xs.map((x,i)=>{

            const xn = Number(x)/rs;
            const yn = -Number(ys[i])/rs;

            return `${xn},${yn}`;

        }).join(' ');

        return `
        <div class="solar-preview">
            <svg viewBox="-1.3 -1.3 2.6 2.6">

                <defs>
                    <radialGradient id="sunGrad">
                        <stop offset="0%" stop-color="#ffdd88" stop-opacity="0.18"/>
                        <stop offset="100%" stop-color="#ffdd88" stop-opacity="0.03"/>
                    </radialGradient>
                </defs>

                <circle cx="0" cy="0" r="1"
                        fill="url(#sunGrad)"/>

                <circle cx="0" cy="0" r="1"
                        fill="none"
                        stroke="#ffd37a"
                        stroke-width="0.012"/>

                <line x1="-1.25" y1="0" x2="1.25" y2="0"
                      stroke="#33455f" stroke-width="0.004"/>

                <line x1="0" y1="-1.25" x2="0" y2="1.25"
                      stroke="#33455f" stroke-width="0.004"/>

                <polygon points="${points}"
                         fill="rgba(86,182,255,0.18)"
                         stroke="#56b6ff"
                         stroke-width="0.01"/>

            </svg>
        </div>`;

    }catch(err){

        console.error(err);
        return '';
    }
}