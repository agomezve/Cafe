const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'public', 'logo-cafe.jpg');
const outDir = path.join(__dirname, '..', 'public', 'icons');
const primary = '#6F4E37';

async function silueta() {
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    for (let i = 0; i < data.length; i += channels) {
        if (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235) {
            data[i + 3] = 0;
        }
    }
    return sharp(data, { raw: { width, height, channels } }).png().trim();
}

const TRANSPARENTE = { r: 0, g: 0, b: 0, alpha: 0 };

async function run() {
    fs.mkdirSync(outDir, { recursive: true });
    const recorte = await silueta().then(img => img.toBuffer());

    for (const size of [192, 512]) {
        const inner = Math.round(size * 0.72);
        await sharp({ create: { width: size, height: size, channels: 4, background: '#ffffff' } })
            .composite([{ input: await sharp(recorte).resize(inner, inner, { fit: 'contain', background: TRANSPARENTE }).toBuffer(), gravity: 'center' }])
            .png()
            .toFile(path.join(outDir, `icon-${size}.png`));
    }

    // Maskable: brand background, cup kept inside the ~80% safe zone
    const maskInner = Math.round(512 * 0.6);
    await sharp({ create: { width: 512, height: 512, channels: 4, background: primary } })
        .composite([{ input: await sharp(recorte).resize(maskInner, maskInner, { fit: 'contain', background: TRANSPARENTE }).toBuffer(), gravity: 'center' }])
        .png()
        .toFile(path.join(outDir, 'icon-maskable-512.png'));

    // Apple touch icon: solid white background, no transparency, 180x180
    const appleInner = Math.round(180 * 0.72);
    await sharp({ create: { width: 180, height: 180, channels: 4, background: '#ffffff' } })
        .composite([{ input: await sharp(recorte).resize(appleInner, appleInner, { fit: 'contain', background: TRANSPARENTE }).toBuffer(), gravity: 'center' }])
        .flatten({ background: '#ffffff' })
        .png()
        .toFile(path.join(outDir, 'apple-touch-icon.png'));

    // Icono de la barra de estado de Android (el "badge" de las
    // notificaciones). Android lo pinta como silueta: solo mira la
    // transparencia y colorea el resto. Así que tiene que ser la taza en
    // blanco sólido sobre fondo transparente; con fondo blanco se vería como
    // un cuadrado relleno.
    const badge = 96;
    const badgeInner = Math.round(badge * 0.7);
    const taza = await sharp(recorte)
        .resize(badgeInner, badgeInner, { fit: 'contain', background: TRANSPARENTE })
        .toBuffer();
    const conMargen = await sharp({ create: { width: badge, height: badge, channels: 4, background: TRANSPARENTE } })
        .composite([{ input: taza, gravity: 'center' }])
        .png()
        .toBuffer();
    // Se queda solo con la forma (el canal alfa) y se pinta toda de blanco
    const alfa = await sharp(conMargen).extractChannel(3).toBuffer();
    await sharp({ create: { width: badge, height: badge, channels: 3, background: '#ffffff' } })
        .joinChannel(alfa)
        .png()
        .toFile(path.join(outDir, 'badge-96.png'));

    // Favicon
    const favInner = Math.round(48 * 0.8);
    await sharp({ create: { width: 48, height: 48, channels: 4, background: '#ffffff' } })
        .composite([{ input: await sharp(recorte).resize(favInner, favInner, { fit: 'contain', background: TRANSPARENTE }).toBuffer(), gravity: 'center' }])
        .png()
        .toFile(path.join(outDir, 'favicon.png'));

    console.log('Iconos generados en', outDir);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
