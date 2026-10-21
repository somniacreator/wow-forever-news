local ADDON = "WFA Armory Exporter"
local VERSION = "0.1.3"

WFAArmoryExportDB = WFAArmoryExportDB or {}

local slots = {
  { id = 1, key = "head" },
  { id = 2, key = "neck" },
  { id = 3, key = "shoulder" },
  { id = 4, key = "shirt" },
  { id = 5, key = "chest" },
  { id = 6, key = "waist" },
  { id = 7, key = "legs" },
  { id = 8, key = "feet" },
  { id = 9, key = "wrist" },
  { id = 10, key = "hands" },
  { id = 11, key = "finger1" },
  { id = 12, key = "finger2" },
  { id = 13, key = "trinket1" },
  { id = 14, key = "trinket2" },
  { id = 15, key = "back" },
  { id = 16, key = "mainhand" },
  { id = 17, key = "offhand" },
  { id = 18, key = "ranged" },
  { id = 19, key = "tabard" },
}

local function safeCall(fn, ...)
  if type(fn) ~= "function" then return nil end
  local results = { pcall(fn, ...) }
  if not results[1] then return nil end
  return unpack(results, 2, math.max(2, table.maxn(results)))
end

local function itemQuality(link)
  if not link then return nil end
  local _, _, quality = safeCall(GetItemInfo, link)
  -- GetItemInfo is empty until the item is cached; the link itself carries
  -- the quality as |cnIQ<n>: on WoW Forever 1.60.x clients.
  return tonumber(quality) or tonumber(tostring(link):match("|cnIQ(%d+)"))
end

local function round(value, digits)
  value = tonumber(value)
  if not value then return nil end
  local factor = 10 ^ (digits or 2)
  return math.floor(value * factor + 0.5) / factor
end

-- Values exactly as the client reports them; anything the API does not
-- provide stays nil instead of being estimated.
local PRIMARY_STATS = { "strength", "agility", "stamina", "intellect", "spirit" }
local SPELL_SCHOOLS = { "physical", "holy", "fire", "nature", "frost", "shadow", "arcane" }

local function captureStats()
  local stats = {}

  stats.health_max = tonumber(safeCall(UnitHealthMax, "player"))
  local _, powerToken = safeCall(UnitPowerType, "player")
  stats.power_type = powerToken
  stats.power_max = tonumber(safeCall(UnitPowerMax, "player"))

  stats.primary = {}
  for index, key in ipairs(PRIMARY_STATS) do
    local base, effective, positive, negative = safeCall(UnitStat, "player", index)
    if base or effective then
      stats.primary[key] = { base = base, effective = effective, bonus = positive, penalty = negative }
    end
  end

  local armorBase, armorEffective, _, armorPositive, armorNegative = safeCall(UnitArmor, "player")
  if armorBase or armorEffective then
    stats.armor = { base = armorBase, effective = armorEffective, bonus = armorPositive, penalty = armorNegative }
  end

  local apBase, apPositive, apNegative = safeCall(UnitAttackPower, "player")
  local minDamage, maxDamage, minOffhand, maxOffhand = safeCall(UnitDamage, "player")
  local mainSpeed, offSpeed = safeCall(UnitAttackSpeed, "player")
  stats.melee = {
    attack_power = apBase and { base = apBase, bonus = apPositive, penalty = apNegative } or nil,
    crit_chance = round(safeCall(GetCritChance)),
    hit_bonus = round(safeCall(GetHitModifier)),
    damage_min = round(minDamage, 1),
    damage_max = round(maxDamage, 1),
    offhand_damage_min = round(minOffhand, 1),
    offhand_damage_max = round(maxOffhand, 1),
    speed = round(mainSpeed),
    offhand_speed = round(offSpeed),
  }

  local rapBase, rapPositive, rapNegative = safeCall(UnitRangedAttackPower, "player")
  local rangedSpeed, rangedMin, rangedMax = safeCall(UnitRangedDamage, "player")
  stats.ranged = {
    attack_power = rapBase and { base = rapBase, bonus = rapPositive, penalty = rapNegative } or nil,
    crit_chance = round(safeCall(GetRangedCritChance)),
    damage_min = round(rangedMin, 1),
    damage_max = round(rangedMax, 1),
    speed = round(rangedSpeed),
  }

  stats.spell = {
    bonus_healing = tonumber(safeCall(GetSpellBonusHealing)),
    hit_bonus = round(safeCall(GetSpellHitModifier)),
    crit_chance = {},
    bonus_damage = {},
  }
  for school = 2, #SPELL_SCHOOLS do
    local key = SPELL_SCHOOLS[school]
    stats.spell.crit_chance[key] = round(safeCall(GetSpellCritChance, school))
    stats.spell.bonus_damage[key] = tonumber(safeCall(GetSpellBonusDamage, school))
  end
  local baseRegen, castingRegen = safeCall(GetManaRegen)
  stats.spell.mana_regen = baseRegen and { base = round(baseRegen), casting = round(castingRegen) } or nil

  stats.defense = {
    dodge_chance = round(safeCall(GetDodgeChance)),
    parry_chance = round(safeCall(GetParryChance)),
    block_chance = round(safeCall(GetBlockChance)),
  }

  stats.resistances = {}
  for school = 2, #SPELL_SCHOOLS do
    local base, total = safeCall(UnitResistance, "player", school - 1)
    if base or total then
      stats.resistances[SPELL_SCHOOLS[school]] = { base = base, total = total }
    end
  end

  return stats
end

local function capture()
  local localizedRace, raceToken = safeCall(UnitRace, "player")
  local localizedClass, classToken = safeCall(UnitClass, "player")
  local faction, factionName = safeCall(UnitFactionGroup, "player")
  local version, build, buildDate, interface = safeCall(GetBuildInfo)
  local gender = tonumber(safeCall(UnitSex, "player"))
  local equipment = {}

  for _, slot in ipairs(slots) do
    local id = tonumber(safeCall(GetInventoryItemID, "player", slot.id))
    local link = safeCall(GetInventoryItemLink, "player", slot.id)
    local texture = safeCall(GetInventoryItemTexture, "player", slot.id)
    if id or link then
      equipment[slot.key] = {
        slot_id = slot.id,
        item_id = id,
        item_link = link,
        quality = itemQuality(link),
        icon = texture,
      }
    end
  end

  local name = safeCall(UnitName, "player")
  local realm = safeCall(GetRealmName)
  local level = tonumber(safeCall(UnitLevel, "player"))
  local guid = safeCall(UnitGUID, "player")

  WFAArmoryExportDB.latest = {
    schema = "wfa-armory-export-v1",
    addon_version = VERSION,
    captured_at = date and date("!%Y-%m-%dT%H:%M:%SZ") or nil,
    client = {
      version = version,
      build = build,
      build_date = buildDate,
      interface = interface,
    },
    character = {
      name = name,
      realm = realm,
      level = level,
      guid = guid,
      race = localizedRace,
      race_token = raceToken,
      class = localizedClass,
      class_token = classToken,
      gender_id = gender,
      faction = faction,
      faction_name = factionName,
    },
    equipment = equipment,
    stats = captureStats(),
  }
  WFAArmoryExportDB.updated_at = WFAArmoryExportDB.latest.captured_at
  return equipment
end

local function countEquipment(equipment)
  local count = 0
  for _, item in pairs(equipment or {}) do
    if item.item_id then count = count + 1 end
  end
  return count
end

local function report()
  local equipment = capture()
  local data = WFAArmoryExportDB.latest
  local character = data and data.character or {}
  local build = data and data.client and data.client.build or "не определён"
  local identity = (character.name or "персонаж") .. " · " .. (character.race or "раса неизвестна") .. " · " .. (character.class or "класс неизвестен")
  print("WFA Armory Exporter: сохранены данные " .. identity)
  print("Экипировка: " .. countEquipment(equipment) .. " предметов; build клиента: " .. tostring(build) .. ".")
  local stats = data and data.stats or {}
  local primary = stats.primary or {}
  local function effective(key) return primary[key] and primary[key].effective or "?" end
  print("Характеристики: сила " .. tostring(effective("strength")) .. ", ловкость " .. tostring(effective("agility")) ..
    ", выносливость " .. tostring(effective("stamina")) .. ", интеллект " .. tostring(effective("intellect")) ..
    ", дух " .. tostring(effective("spirit")) .. "; броня " .. tostring(stats.armor and stats.armor.effective or "?") .. ".")
  print("Выполните /reload или выйдите из игры, чтобы записать SavedVariables на диск.")
  print("Файл будет в WTF\\Account\\...\\SavedVariables\\WFA_Armory_Exporter.lua")
end

SLASH_WFAARMORYEXPORTER1 = "/wfa"
SLASH_WFAARMORYEXPORTER2 = "/wfexport"
SlashCmdList = SlashCmdList or {}
SlashCmdList.WFAARMORYEXPORTER = function(message)
  local command = (message or ""):lower():match("^%s*(%S*)")
  if command == "" or command == "export" then
    report()
  elseif command == "show" then
    local data = WFAArmoryExportDB.latest
    if not data then
      print("WFA Armory Exporter: нет сохранённого снимка. Выполните /wfa export.")
    else
      local c = data.character or {}
      print("WFA: " .. tostring(c.name or "?") .. " / " .. tostring(c.race or "?") .. " / " .. tostring(c.class or "?"))
      print("Экипировка: " .. countEquipment(data.equipment) .. " предметов.")
    end
  else
    print("Команды: /wfa export — обновить снимок; /wfa show — показать краткую сводку.")
  end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_EQUIPMENT_CHANGED")
frame:RegisterEvent("UNIT_INVENTORY_CHANGED")
frame:RegisterEvent("PLAYER_LOGOUT")
frame:SetScript("OnEvent", function(_, event, unit)
  if event == "UNIT_INVENTORY_CHANGED" and unit ~= "player" then return end
  capture()
  if event == "PLAYER_LOGIN" then
    print("WFA Armory Exporter готов. Введите /wfa export, затем /reload.")
  end
end)
