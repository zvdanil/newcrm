-- ============================================================
-- Миграция 001: Фундамент — Auth, Семьи, Дети
-- Этап 1: Users, Groups, Parents, Families, Children
-- ============================================================

-- Enum для ролей (жёстко зафиксированы в БД)
CREATE TYPE user_role AS ENUM (
  'owner',
  'admin',
  'manager',
  'accountant',
  'teacher',
  'parent'
);

-- ============================================================
-- ТАБЛИЦА: users
-- ============================================================
CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          user_role   NOT NULL,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ТАБЛИЦА: groups (старшая, младшая, подготовительная и т.д.)
-- ============================================================
CREATE TABLE groups (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ТАБЛИЦА: parents (плательщики)
-- ============================================================
CREATE TABLE parents (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  VARCHAR(255) NOT NULL,
  phone      VARCHAR(50),
  email      VARCHAR(255),
  user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ТАБЛИЦА: families (семейный аккаунт)
-- ============================================================
CREATE TABLE families (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(255) NOT NULL,
  primary_parent_id UUID        NOT NULL REFERENCES parents(id),
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ТАБЛИЦА: family_members (связь родителей с семьёй, many-to-many)
-- ============================================================
CREATE TABLE family_members (
  family_id  UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  parent_id  UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  PRIMARY KEY (family_id, parent_id)
);

-- ============================================================
-- ТАБЛИЦА: children
-- ============================================================
CREATE TABLE children (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  VARCHAR(255) NOT NULL,
  birth_date DATE,
  family_id  UUID        REFERENCES families(id) ON DELETE SET NULL,
  group_id   UUID        REFERENCES groups(id) ON DELETE SET NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ИНДЕКСЫ
-- ============================================================
CREATE INDEX idx_users_email        ON users(email);
CREATE INDEX idx_users_role         ON users(role);
CREATE INDEX idx_parents_user_id    ON parents(user_id);
CREATE INDEX idx_parents_phone      ON parents(phone);
CREATE INDEX idx_fm_family_id       ON family_members(family_id);
CREATE INDEX idx_fm_parent_id       ON family_members(parent_id);
CREATE INDEX idx_children_family_id ON children(family_id);
CREATE INDEX idx_children_group_id  ON children(group_id);
CREATE INDEX idx_children_is_active ON children(is_active);
-- Индекс для полнотекстового поиска по ФИО детей
CREATE INDEX idx_children_full_name ON children USING gin(to_tsvector('simple', full_name));

-- ============================================================
-- ТРИГГЕР: автообновление updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_parents_updated_at
  BEFORE UPDATE ON parents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_families_updated_at
  BEFORE UPDATE ON families
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_children_updated_at
  BEFORE UPDATE ON children
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SEED: Начальные данные (группы + Owner-аккаунт)
-- Пароль owner: "iris2024" (хэш bcrypt 12 раундов)
-- ============================================================
INSERT INTO groups (name, sort_order) VALUES
  ('Молодша',        1),
  ('Середня',        2),
  ('Старша',         3),
  ('Підготовча',     4);

INSERT INTO users (email, password_hash, role) VALUES (
  'owner@iris.local',
  '$2b$12$LmzaTAxABPVP1LrYg2KN8e1ZUZEEFrhCY/Z9FsrcCFFelR7MyPhTm',
  'owner'
);
