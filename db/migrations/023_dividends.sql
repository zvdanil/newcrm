-- Настройка участников (партнеров)
CREATE TABLE equity_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    share_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Глобальные настройки дивидендов
CREATE TABLE dividend_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    default_tax_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00
);

-- Вставляем дефолтную запись с ID 1
INSERT INTO dividend_settings (id, default_tax_pct) VALUES (1, 0.00);

-- Журнал выплат дивидендов
CREATE TABLE dividend_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID NOT NULL REFERENCES equity_participants(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'cash' или 'cashless'
    tax_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    gross_amount NUMERIC(15, 2) NOT NULL,
    net_amount NUMERIC(15, 2) NOT NULL,
    note TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Связь с расходами
ALTER TABLE expenses 
ADD COLUMN dividend_payout_id UUID REFERENCES dividend_payouts(id) ON DELETE SET NULL;
