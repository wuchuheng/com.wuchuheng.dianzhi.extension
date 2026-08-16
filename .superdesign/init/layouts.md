# Shared Layouts

There is no production shared application layout yet. Each Chrome surface has an independent React root. The content surface mounts inside an open Shadow DOM in `src/content/main.tsx`; Options, Popup, and Side Panel mount into their own extension-page `#root`. `MacWindowShell` is demo code and is not part of the Dianzhi layout.
