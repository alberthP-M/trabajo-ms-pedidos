import jwt from 'jsonwebtoken';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace(/^--/, '');
  const value = process.argv[i + 1];
  if (key && value) args.set(key, value);
}

const role = args.get('role') ?? 'cliente';
const sub = args.get('sub') ?? (role === 'sucursal' ? 'branch-user-demo' : 'cliente-demo');
const branchId = args.get('branchId');
const secret = process.env.JWT_SECRET ?? 'dev-only-change-me';
const payload: Record<string, string> = { sub, role };
if (role === 'sucursal') payload.branchId = branchId ?? 'sucursal-centro';

const token = jwt.sign(payload, secret, {
  algorithm: 'HS256',
  issuer: process.env.JWT_ISSUER ?? 'trabajo-pedidos',
  audience: process.env.JWT_AUDIENCE ?? 'trabajo-pedidos-api',
  expiresIn: (args.get('expiresIn') ?? '2h') as any,
});

process.stdout.write(`${token}\n`);
