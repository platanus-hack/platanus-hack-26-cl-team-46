import {
  deriveDbPassword,
  sandboxRoleName,
  transferOwnershipSql,
} from './database.provisioner.js';

describe('aislamiento de bases de sandboxes', () => {
  it('el rol se llama como la base', () => {
    expect(sandboxRoleName('sbx_1234abcd')).toBe('sbx_1234abcd');
  });

  it('la contraseña es estable por rol y distinta entre roles', () => {
    const a1 = deriveDbPassword('secreto-de-prueba-largo', 'sbx_a');
    const a2 = deriveDbPassword('secreto-de-prueba-largo', 'sbx_a');
    const b = deriveDbPassword('secreto-de-prueba-largo', 'sbx_b');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).toMatch(/^[A-Za-z0-9_-]{40,}$/); // segura para URL y para un literal SQL
  });

  it('otro secreto da otra contraseña', () => {
    expect(deriveDbPassword('secreto-uno-largo', 'sbx_a')).not.toBe(
      deriveDbPassword('secreto-dos-largo', 'sbx_a'),
    );
  });

  it('el SQL de traspaso cubre tablas, secuencias, tipos y funciones, y salta extensiones', () => {
    const sql = transferOwnershipSql('sbx_a');
    expect(sql).toContain("rolname = 'sbx_a'");
    expect(sql).toContain('ALTER SCHEMA');
    expect(sql).toContain("'SEQUENCE'");
    expect(sql).toContain("'DOMAIN' ELSE 'TYPE'");
    expect(sql).toContain("'PROCEDURE'");
    expect(sql).toContain("d.deptype = 'e'");
  });

  it('escapa comillas en el nombre del rol', () => {
    expect(transferOwnershipSql("x'y")).toContain("rolname = 'x''y'");
  });
});
