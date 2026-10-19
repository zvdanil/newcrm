UPDATE users
SET password_hash = '$2b$12$B95AAMZHO1cOB/1djN9xVe0XA6iHWR.M/OX/e5Kmq3QuJWGJVs2p.',
    updated_at = NOW()
WHERE email = 'owner@iris.local';
