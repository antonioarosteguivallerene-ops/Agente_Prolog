# Agente intérprete de Prolog (Unidad III)

Página web con un cuadro de texto, un botón "Enviar al agente" y un área de respuesta ("Esta es la respuesta: ...").

## Archivos
- `index.html`: estructura de la página
- `styles.css`: estilos
- `app.js`: separa programa y consultas, ejecuta con Tau Prolog y explica el resultado

## Probar en Visual Studio Code
1. Abre la carpeta con **Archivo > Abrir carpeta**.
2. Instala la extensión **Live Server** (Ritwick Dey).
3. Clic derecho en `index.html` > **Open with Live Server**.

## Publicar y obtener la URL pública (GitHub Pages)
1. Crea un repositorio público en GitHub y sube los 3 archivos.
2. En el repositorio: **Settings > Pages > Deploy from a branch > main / (root)**.
3. La URL quedará como `https://TU-USUARIO.github.io/NOMBRE-REPO/`. Esa es la que entregas.

(Alternativas: Netlify Drop o Vercel, arrastrando la carpeta.)

## Notas
- El resultado lo calcula Tau Prolog, un intérprete real, así que cubre hechos, reglas, aritmética, listas, negación (`\+`), disyunción (`;`) y corte (`!`).
- La explicación base se genera localmente. Opcionalmente puedes pegar una API key de Anthropic para una explicación más detallada con IA; la clave no se guarda.
- Las consultas van en líneas que empiezan con `?-`; puedes poner varias.
