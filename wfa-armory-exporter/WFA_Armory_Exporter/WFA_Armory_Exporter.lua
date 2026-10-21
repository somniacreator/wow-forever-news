local ADDON = "WFA Armory Exporter"
local VERSION = "0.1.1"

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
  local ok, a, b, c, d = pcall(fn, ...)
  if ok then return a, b, c, d end
  return nil
end

local function itemQuality(link)
  if not link then return nil end
  local _, _, quality = safeCall(GetItemInfo, link)
  return tonumber(quality)
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
frame:SetScript("OnEvent", function(_, event, unit)
  if event == "UNIT_INVENTORY_CHANGED" and unit ~= "player" then return end
  capture()
  if event == "PLAYER_LOGIN" then
    print("WFA Armory Exporter готов. Введите /wfa export, затем /reload.")
  end
end)
