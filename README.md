# Landing interactiva GuauFresh

Versión final de la tarjeta virtual de GuauFresh, optimizada para móviles y preparada para desplegarse en Vercel y registrar clientes en Supabase.

## Producción

- Landing: <https://guaufresh-landing.vercel.app>
- Proyecto Vercel: `guaufresh-landing`
- Proyecto Supabase: `hnhouomerovkukwpcwym`
- Función de registro: `register-client`

## Contenido

- `index.html`: landing autocontenida con imágenes, estilos, interacciones, QR de pago y formulario.
- `assets/logo-guaufresh-original.png`: archivo maestro del logotipo suministrado por la marca.
- `supabase/migrations/`: esquema versionado de la base de clientes.
- `supabase/functions/register-client/`: función pública de registro con validación, control de origen y límite de solicitudes.
- `vercel.json`: configuración de rutas y encabezados de seguridad.

## Desarrollo local

```bash
python3 -m http.server 4173
```

Abrir `http://localhost:4173`.

## Despliegue

Vercel detecta el proyecto como un sitio estático y publica `index.html` desde la raíz. La configuración excluye del artefacto público la documentación, el archivo maestro del logo y el código de Supabase. No se deben guardar tokens, llaves privadas ni credenciales en este repositorio.

## Backend

La migración crea una tabla privada `clients`. El navegador no puede consultar la base: los registros entran únicamente mediante la función `register-client`, que valida la estructura, aplica un límite por origen y utiliza la clave de servicio dentro del entorno protegido de Supabase.

Para reproducir el backend en otro entorno:

1. Aplicar la migración `create_guaufresh_clients`.
2. Desplegar la función `register-client` sin verificación JWT, ya que implementa validación pública propia para el formulario.
3. Configurar en la landing el endpoint `https://<project-ref>.supabase.co/functions/v1/register-client`.
4. Probar un registro y verificarlo directamente en la tabla `clients`.

La instancia productiva ya tiene la migración y la función desplegadas. La clave con privilegios de servicio permanece exclusivamente en Supabase y nunca se expone al navegador.

## Verificación

Consultar [`QA_PRODUCCION.md`](QA_PRODUCCION.md) para ver el recorrido probado y los controles técnicos revisados.

## Privacidad

El formulario recoge datos de contacto, ciudad, información básica de la mascota, interés comercial y consentimiento. La operación productiva debe acompañarse de una política de tratamiento de datos con canal para consulta, corrección y eliminación.
