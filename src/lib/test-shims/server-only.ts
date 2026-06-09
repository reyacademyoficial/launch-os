// Shim para vitest. En Next.js, `import "server-only"` es un guard que rompe
// el build si el módulo termina en un bundle de cliente. En tests node-puros
// no hay bundle de cliente — el guard no aplica y este archivo queda vacío.
export {};
