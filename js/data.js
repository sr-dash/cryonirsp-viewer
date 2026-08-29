/* =====================================================
   DATA LAYER

   Loads the published inventory and derives the fields
   the new front end queries on. The inventory contract
   is data/SCHEMA.md; this is the only file that reads
   raw records.
===================================================== */

const INVENTORY_URL = 'data/cryonirsp_dataset_details.json';

const RELEASE_TAG = 'media-v2';
const MEDIA_BASE =
    `https://github.com/sr-dash/cryonirsp-media/releases/download/${RELEASE_TAG}/`;

// Line colours resolve to CSS custom properties rather than literals, so
// tokens.css stays the single source of truth and the encoding re-derives
// itself when the theme flips — the light palette needs darker hues to hold
// contrast on a pale ground.
export const LINE_KEYS = ['fexiii_1074', 'fexiii_1079', 'hei_1083', 'six_1430'];

export const LINE_COLOR = Object.fromEntries(
    LINE_KEYS.map((k) => [k, `var(--${k})`])
);

export const LINE_SHORT = {
    fexiii_1074: 'Fe XIII 1074.7',
    fexiii_1079: 'Fe XIII 1079.8',
    hei_1083:    'He I 1083.0',
    six_1430:    'Si X 1430.0'
};

export const TARGET_LABEL = {
    activecorona: 'Active corona',
    quietcorona:  'Quiet corona',
    prominence:   'Prominence',
    coronalhole:  'Coronal hole',
    unknown:      'Unclassified'
};

export const MODE_LABEL = {
    spectroscopy: 'Spectroscopy',
    spectropolarimetry: 'Spectropolarimetry',
    context_imaging: 'Context imaging',
    context_imaging_polarimetry: 'CI polarimetry'
};

// -----------------------------------------------------
// helpers
// -----------------------------------------------------

const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

export function fmtDuration(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    const t = Math.floor(seconds);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
}

export function fmtSize(gib) {
    if (gib === null || gib === undefined) return '—';
    return gib >= 10 ? `${gib.toFixed(0)} GiB` : `${gib.toFixed(2)} GiB`;
}

// Days from now until an ISO instant; negative once it has passed.
export function daysUntil(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return Math.ceil((t - Date.now()) / 86400000);
}

export function fmtDate(iso) {
    return iso ? iso.slice(0, 10) : '—';
}

export function utcStamp(iso) {
    if (!iso) return '—';
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return '—';
    return `${t.toISOString().slice(0, 10)} ${t.toISOString().slice(11, 19)} UTC`;
}

// Radial distance and position angle come from the inventory, which
// measures both to the reference pointing. Deriving them here from the
// footprint centroid instead gives a subtly different number (~0.07 R
// higher) — the same observation would appear at two heights depending
// on which screen you read. Only fall back when the fields are absent.
function geometry(record) {
    const r = num(record.radial_distance);
    const pa = num(record.position_angle_deg);
    if (r !== null && pa !== null) return { r, pa };

    const sb = record.spatial_bounds_arcsec;
    const rs = num(record.solar_radius_arcsec) || 963.1;
    if (!Array.isArray(sb) || sb.length !== 2) return { r: r, pa: pa };

    const xs = sb[0], ys = sb[1];
    if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length < 2) return { r: r, pa: pa };

    // Drop the repeated closing vertex before averaging.
    const n = (xs[0] === xs[xs.length - 1] && ys[0] === ys[ys.length - 1]) ? xs.length - 1 : xs.length;
    const cx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const cy = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;

    return {
        r: r !== null ? r : Math.hypot(cx, cy) / rs,
        pa: pa !== null ? pa : (Math.atan2(cy, cx) * 180 / Math.PI + 360) % 360
    };
}

function radialBin(r) {
    if (r === null) return null;
    if (r < 0.95) return 'disk';
    if (r < 1.05) return 'limb';
    if (r <= 1.30) return 'near';
    return 'far';
}

// -----------------------------------------------------
// load
// -----------------------------------------------------

export async function loadArchive() {
    const res = await fetch(INVENTORY_URL);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${INVENTORY_URL}`);

    const payload = await res.json();

    const raw = payload.datasets || payload;
    const declaredAliases = payload.dataset_aliases || {};

    const records = [];
    const byId = new Map();

    Object.keys(raw).forEach((key) => {
        const d = raw[key];
        const g = geometry(d);
        const superseded = Array.isArray(d.inactive_dataset_ids) ? d.inactive_dataset_ids : [];

        const rec = {
            id: d.dataset_id || key,
            product: d.product_id,
            program: d.observingProgramExecutionId,
            experiment: d.experiment_id,
            proposal: d.proposal_id,

            line: d.waveband_key,
            lineLabel: d.waveband,
            lineWave: num(d.line_wave),

            target: d.object || 'unknown',
            mode: d.observing_mode,
            arm: d.arm,
            stokes: d.stokes_parameters,
            contextImager: d.is_context_imager === true,
            fittable: d.is_fittable === true,

            start: d.start_time,
            end: d.end_time,
            date: d.start_time ? d.start_time.slice(0, 10) : null,
            month: d.start_time ? d.start_time.slice(0, 7) : null,
            time: d.start_time ? Date.parse(d.start_time) : 0,
            durationSeconds: num(d.duration_seconds),

            sizeGiB: num(d.dataset_size_gib),
            frames: num(d.number_of_frames),
            shape: d.dataset_shape_str,
            scanSteps: num(d.n_scanSteps),

            stepWidth: num(d.stepWidth_arcsec),
            slitSampling: num(d.slitSampling_arcsec),
            solarRadius: num(d.solar_radius_arcsec),
            bounds: d.spatial_bounds_arcsec || null,

            r: g.r,
            pa: g.pa,
            rbin: radialBin(g.r),

            superseded,
            supersededStatus: d.archived_status || {},
            status: d.dataset_status,
            calVersion: d.calibration_workflow_version,

            description: d.experiment_description || '',
            previewUrl: d.preview_url,
            metadataFile: d.metadata_file,

            // Availability is worked out from the lift date, not from the
            // stored flag. This page is static and the inventory can be months
            // old, so a boolean would keep claiming an embargo that has since
            // expired. Comparing a date to now makes the page self-correcting.
            embargoEnd: d.embargo_end_date || null,
            embargoFlag: d.embargoed === true,
            downloadable: d.downloadable !== false,

            image: d.context_image ? MEDIA_BASE + d.context_image : null,
            movie: d.context_movie ? MEDIA_BASE + d.context_movie : null,
            poster: d.context_movie_thumbnail ? MEDIA_BASE + d.context_movie_thumbnail : null
        };

        const lifts = rec.embargoEnd ? daysUntil(rec.embargoEnd) : null;

        // embargoed  — restricted now, lifts on a known date
        // lapsed     — the inventory still says embargoed but the date passed
        // released   — was embargoed, now open
        // open       — never embargoed
        rec.liftsInDays = lifts;
        rec.embargoed = lifts !== null ? lifts > 0 : rec.embargoFlag;
        rec.embargoState = rec.embargoed
            ? 'embargoed'
            : (rec.embargoFlag ? 'lapsed' : (rec.embargoEnd ? 'released' : 'open'));

        // One lowercase haystack per record for the bare-word search.
        rec.haystack = [
            rec.id, rec.product, rec.program, rec.experiment, rec.proposal,
            rec.lineLabel, rec.target, rec.mode, rec.date,
            superseded.join(' '), rec.description,
            rec.embargoed ? 'embargoed' : 'public available'
        ].join(' ').toLowerCase();

        records.push(rec);
        byId.set(rec.id.toUpperCase(), rec);
    });

    // Superseded id -> the record that replaced it.
    const aliases = new Map();
    Object.keys(declaredAliases).forEach((old) => {
        const up = old.toUpperCase();
        if (!byId.has(up)) aliases.set(up, declaredAliases[old].toUpperCase());
    });
    if (!aliases.size) {
        records.forEach((r) => r.superseded.forEach((old) => {
            const up = old.toUpperCase();
            if (!byId.has(up) && !aliases.has(up)) aliases.set(up, r.id.toUpperCase());
        }));
    }

    records.sort((a, b) => b.time - a.time);

    return {
        records,
        byId,
        aliases,
        meta: {
            schemaVersion: payload.schema_version || null,
            generatedAt: payload.generated_at || null,
            source: payload.source || null
        }
    };
}

// Accepts a current id, a superseded id, or a product id.
export function resolve(archive, token) {
    if (!token) return null;
    const key = String(token).trim().toUpperCase();

    if (archive.byId.has(key)) return archive.byId.get(key);

    const aliased = archive.aliases.get(key);
    if (aliased && archive.byId.has(aliased)) return archive.byId.get(aliased);

    return archive.records.find((r) => r.product && r.product.toUpperCase() === key) || null;
}

export { MEDIA_BASE, RELEASE_TAG };
