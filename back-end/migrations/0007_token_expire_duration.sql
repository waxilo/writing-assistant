-- token_expire_ms 的语义由「绝对过期时间戳」改为「有效时长（毫秒）」。
-- 绝对过期时间 = login_time + token_expire_ms，由查询侧计算。
--
-- 历史数据里存的是毫秒时间戳（> 1e12，约 2001-09 之后），
-- 而时长最大为 30 天（约 2.6e9），因此可以用阈值安全区分，且该语句可重复执行。

UPDATE t_login_log
SET token_expire_ms = MAX(
      token_expire_ms - CAST(strftime('%s', login_time) AS INTEGER) * 1000,
      0
    )
WHERE token_expire_ms > 1000000000000;
