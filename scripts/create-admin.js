'use strict';
/* Crea un administrador desde la consola:  npm run create-admin
   o sin preguntas:  node scripts/create-admin.js usuario contraseña */
const readline = require('readline');
const { createAdmin } = require('../src/auth');

async function ask(rl, q, hidden = false) {
  if (!hidden) return new Promise((r) => rl.question(q, r));
  return new Promise((resolve) => {
    const out = rl.output;
    const write = out.write.bind(out);
    rl.question(q, (a) => { out.write = write; out.write('\n'); resolve(a); });
    out.write = (s) => (s.includes(q) ? write(s) : write(''));
  });
}

(async () => {
  let [user, pass] = process.argv.slice(2);
  if (!user || !pass) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    user = user || (await ask(rl, 'Usuario: '));
    pass = await ask(rl, 'Contraseña (mínimo 8 caracteres): ', true);
    const again = await ask(rl, 'Repetir contraseña: ', true);
    rl.close();
    if (pass !== again) { console.error('✖ Las contraseñas no coinciden.'); process.exit(1); }
  }
  try {
    await createAdmin(user, pass);
    console.log(`✔ Administrador "${user}" creado. Ingresá en /admin`);
    process.exit(0);
  } catch (e) {
    console.error('✖', e.message);
    process.exit(1);
  }
})();
