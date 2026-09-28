# Torrenueva FS · 2026/27

Una PWA por equipo, con el mismo código para las dos:

| Equipo  | Enlace | Carpeta | Admins |
|---------|--------|---------|--------|
| Senior  | `https://<tu-dominio>/senior/`  | `senior/`  | Antonio, Adrián Vivar, Salva |
| Juvenil | `https://<tu-dominio>/juvenil/` | `juvenil/` | Adrián Mister, Jesús |

Cada carpeta tiene su propio `manifest.webmanifest`, sus iconos y su `sw.js`, así que cada enlace se instala como
una app independiente y guarda su propia sesión. La raíz (`/`) es una portada con los dos enlaces.

```
app/            código compartido: app.js, app.css, icons.js (css.gg), Inter, supabase-js
senior/         PWA del senior    (window.TEAM = { slug: 'senior', … })
juvenil/        PWA del juvenil   (window.TEAM = { slug: 'juvenil', … })
supabase/       migraciones, seed y la edge function «notify» (push)
```

## Identidad

Inter, blanco y negro, y un único acento por equipo: verde `#00CB57` en el senior y amarillo `#FFD100` en el juvenil.
El acento siempre va de fondo con texto negro encima. No hay sombras ni degradados: la estructura se marca con filetes
de 1 px, cifras grandes y la fila «→ etiqueta · valor». Iconos: [css.gg](https://github.com/astrit/css.gg) (MIT).
css.gg no tiene balón, así que el balón del icono de la app está dibujado aparte con la misma geometría.

## Pantallas

* **Multas** (inicio): el bote pendiente, tu deuda y las multas por jugador. Se duplican a los 15 días (×2) y a los
  29 (×4); los cobros no se duplican. El pago que sobra queda como saldo a favor.
* **Feed**: partidos publicados por los jugadores (rival, resultado, goles, asistencias, paradas, foto) y cada multa
  nueva. Todo admite kudos y comentarios. Publicar un partido suma automáticamente a las estadísticas del jugador,
  y borrarlo las resta.
* **Plantilla** y **ficha**: líderes (goles y asistencias), foto (la puede cambiar cualquiera) y estadísticas de
  futsal. Los porteros tienen además paradas, goles encajados y porterías a cero.
* **Historial**: recaudación, quién más ha aportado, multas pagadas por mes y movimientos de saldo.

## Acceso

* **Crear cuenta**: el jugador elige su nombre, mete el código del equipo y una contraseña. Cada nombre se reclama
  una sola vez, y el servidor lo valida en un trigger de `auth.users`.
* **Entrar**: toca su nombre y pone la contraseña. Por dentro se usa un email `<id>@jugadores.torrenuevafs.app`, que no recibe correo.
* **Admins**: dan de alta jugadores, dan de baja, liberan cuentas (si alguien olvida la contraseña) y ven el espacio de fotos usado.
* Cambiar el código de un equipo:
  ```sql
  update public.teams set join_code_hash = extensions.crypt('NUEVO-CODIGO', extensions.gen_salt('bf')) where slug = 'senior';
  ```

En Supabase (Authentication → Sign In / Providers → Email) tiene que estar **Confirm email desactivado**.

## Fotos sin llenar el almacenamiento

El plan gratuito da 1 GB para los dos equipos.

* Las fotos se comprimen en el móvil antes de subirlas: WebP (o JPEG en Safari antiguo). Las de perfil se recortan a
  480×480 (~30–60 KB) y las de partido a 1280 px de lado (~120–250 KB).
* El bucket rechaza archivos de más de 1,5 MB y todo lo que no sea WebP o JPEG.
* Al cambiar o quitar una foto de perfil se borra la anterior. Al borrar una publicación se borra su foto.
* Los admins ven el uso en *Mi cuenta → Espacio de fotos*. A ~200 KB por foto caben unas 5.000.

## Notificaciones push

* Triggers en `posts`, `post_comments` y `post_likes` llaman con `pg_net` a la edge function `notify`, que las envía con Web Push (VAPID).
* **Se avisa de**: partido nuevo y multa nueva a todo el equipo; comentario al autor y al jugador; kudos al jugador.
* **Recordatorio de multas**: cada día a las 08:00 UTC (10:00 en verano, 9:00 en invierno), `pg_cron` avisa a cada jugador
  con multas que pasan a ×2 o ×4 en 2 días. Si tiene varias, recibe una sola notificación. Job: `fine-reminders`.
* Las claves VAPID y el secreto del webhook están en `public.app_secrets`, que solo puede leer el servidor.
* Cada jugador las activa en *Mi cuenta → Notificaciones*.
* **Android**: funcionan en Chrome, esté o no instalada la app.
* **iPhone** (iOS 16.4 o superior): solo con la app instalada en la pantalla de inicio.

## Temporada 2025/26

Las tablas antiguas (`players`, `multas`, `lives_log`, `matches`, `match_players`, `mvp_votes`, `premios`, `config`)
siguen en la base de datos como archivo, pero están bloqueadas: la clave pública no puede leerlas ni modificarlas.
Solo se consultan desde el panel de Supabase.
