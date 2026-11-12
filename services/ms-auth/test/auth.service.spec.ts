import { AuthService } from '../src/auth.service';
import { hashPassword } from '../src/password';

describe('AuthService', () => {
  it('inicia sesión y devuelve access/refresh tokens', async () => {
    const db: any = { findByEmail: jest.fn().mockResolvedValue({ id: 'u-1', email: 'cliente@test.local', passwordHash: await hashPassword('password123'), role: 'cliente', active: true }), saveRefreshToken: jest.fn() };
    const service = new AuthService(db);
    const result = await service.login('cliente@test.local', 'password123');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(db.saveRefreshToken).toHaveBeenCalled();
  });

  it('rechaza una contraseña incorrecta', async () => {
    const db: any = { findByEmail: jest.fn().mockResolvedValue({ id: 'u-1', email: 'cliente@test.local', passwordHash: await hashPassword('password123'), role: 'cliente', active: true }) };
    const service = new AuthService(db);
    await expect(service.login('cliente@test.local', 'incorrecta')).rejects.toThrow('Credenciales inválidas');
  });
});
