-- Where each piece of equipment came from, recorded at the moment it is received:
-- a quest reward (quest, quest giver, place, the chain of quests seen before it),
-- loot (from whom) or a purchase (from which vendor). The game does not tell
-- addons this afterwards, so only items received with the addon running are known.
-- Records live in WFAArmoryExportDB.sources[itemId] and are exported with the item.

local MAX_SOURCES = 200
local MAX_QUEST_LOG = 300
local CHAIN_WINDOW = 600 -- seconds between turning in a quest and taking the next one from the same NPC

local function safeCall(fn, ...)
  if type(fn) ~= "function" then return nil end
  local results = { pcall(fn, ...) }
  if not results[1] then return nil end
  return unpack(results, 2, math.max(2, table.maxn(results)))
end

local function store()
  WFAArmoryExportDB = WFAArmoryExportDB or {}
  local db = WFAArmoryExportDB
  db.sources = db.sources or {}
  db.quest_log = db.quest_log or {}
  db.quest_prev = db.quest_prev or {}
  return db
end

local function itemIdFromLink(link)
  return tonumber(link and tostring(link):match("item:(%d+)"))
end

local function isEquipment(link)
  if not link then return false end
  if type(IsEquippableItem) == "function" then return safeCall(IsEquippableItem, link) and true or false end
  return true
end

-- NPC ID from a creature GUID: "Creature-0-<server>-<instance>-<zone>-<npcId>-<spawn>".
local function npcIdFromGuid(guid)
  local kind, _, _, _, _, npcId = strsplit("-", tostring(guid or ""))
  if kind == "Creature" or kind == "Vehicle" then return tonumber(npcId) end
  return nil
end

-- The player's place: zone map, its name, sub-zone and coordinates (0..1 of the zone map).
local function place()
  local out = { zone = safeCall(GetZoneText), subzone = safeCall(GetSubZoneText) }
  if out.subzone == "" then out.subzone = nil end
  if C_Map and type(C_Map.GetBestMapForUnit) == "function" then
    local mapId = safeCall(C_Map.GetBestMapForUnit, "player")
    if mapId then
      out.map_id = mapId
      local info = safeCall(C_Map.GetMapInfo, mapId)
      if type(info) == "table" and info.name then out.map_name = info.name end
      local position = safeCall(C_Map.GetPlayerMapPosition, mapId, "player")
      if position and position.GetXY then
        local x, y = position:GetXY()
        if x and y and (x > 0 or y > 0) then
          out.x = math.floor(x * 1000 + 0.5) / 1000
          out.y = math.floor(y * 1000 + 0.5) / 1000
        end
      end
    end
  end
  return out
end

local function npc()
  local name = safeCall(UnitName, "npc")
  if not name then return nil end
  return { name = name, id = npcIdFromGuid(safeCall(UnitGUID, "npc")) }
end

local function remember(itemId, record)
  if not itemId then return end
  local db = store()
  record.at = date and date("!%Y-%m-%dT%H:%M:%SZ") or nil
  db.sources[itemId] = record
  -- Keep the newest MAX_SOURCES records.
  local ids = {}
  for id in pairs(db.sources) do ids[#ids + 1] = id end
  if #ids > MAX_SOURCES then
    table.sort(ids, function(a, b) return tostring(db.sources[a].at or "") < tostring(db.sources[b].at or "") end)
    for i = 1, #ids - MAX_SOURCES do db.sources[ids[i]] = nil end
  end
end

-- The chain seen by this character: quests taken from an NPC right after turning one in to them.
local function chainFor(questId)
  local db, chain, seen = store(), {}, {}
  local current = db.quest_prev[questId]
  while current and not seen[current] and #chain < 10 do
    seen[current] = true
    local entry
    for i = #db.quest_log, 1, -1 do
      if db.quest_log[i].id == current then entry = db.quest_log[i] break end
    end
    table.insert(chain, 1, { id = current, title = entry and entry.title or nil })
    current = db.quest_prev[current]
  end
  return #chain > 0 and chain or nil
end

-- ---- Quests ----
local offered = {}     -- questId -> NPC who offered it (seen in the quest window)
local completing       -- the quest whose reward window is open
local lastTurnIn       -- { id, npc, time } of the last quest turned in

local function questIdOpen()
  return tonumber(safeCall(GetQuestID))
end

local function onQuestDetail()
  local questId = questIdOpen()
  if questId then offered[questId] = npc() end
end

local function onQuestComplete()
  local questId = questIdOpen()
  if not questId then return end
  local rewards, choices = {}, {}
  for i = 1, tonumber(safeCall(GetNumQuestRewards)) or 0 do rewards[#rewards + 1] = safeCall(GetQuestItemLink, "reward", i) end
  for i = 1, tonumber(safeCall(GetNumQuestChoices)) or 0 do choices[i] = safeCall(GetQuestItemLink, "choice", i) end
  completing = { id = questId, title = safeCall(GetTitleText), npc = npc(), place = place(), rewards = rewards, choices = choices }
end

local function recordQuestReward(link, quest)
  if not isEquipment(link) then return end
  local record = { type = "quest", quest_id = quest.id, quest_title = quest.title, chain = chainFor(quest.id) }
  if quest.npc then record.npc = quest.npc.name record.npc_id = quest.npc.id end
  local giver = offered[quest.id] or store().quest_givers and store().quest_givers[quest.id]
  if giver and giver.name ~= record.npc then record.giver = giver.name record.giver_id = giver.id end
  for key, value in pairs(quest.place or {}) do record[key] = value end
  remember(itemIdFromLink(link), record)
end

local function onQuestReward(choice)
  local quest = completing
  if not quest then return end
  for _, link in ipairs(quest.rewards) do recordQuestReward(link, quest) end
  local chosen = quest.choices[tonumber(choice) or 0] or (#quest.choices == 1 and quest.choices[1]) or nil
  if chosen then recordQuestReward(chosen, quest) end
end

local function onQuestTurnedIn(questId)
  questId = tonumber(questId)
  if not questId then return end
  local db = store()
  local quest = completing and completing.id == questId and completing or nil
  db.quest_log[#db.quest_log + 1] = { id = questId, title = quest and quest.title or nil, npc = quest and quest.npc and quest.npc.name or nil }
  while #db.quest_log > MAX_QUEST_LOG do table.remove(db.quest_log, 1) end
  lastTurnIn = { id = questId, npc = quest and quest.npc and quest.npc.name or nil, time = safeCall(GetTime) or 0 }
  completing = nil
end

local function onQuestAccepted(arg1, arg2)
  -- Classic passes (questLogIndex, questId); newer clients pass (questId).
  local questId = tonumber(arg2) or tonumber(arg1)
  if not questId then return end
  local db = store()
  local giver = offered[questId]
  if giver then
    db.quest_givers = db.quest_givers or {}
    db.quest_givers[questId] = giver
  end
  local now = safeCall(GetTime) or 0
  if lastTurnIn and giver and lastTurnIn.npc == giver.name and lastTurnIn.id ~= questId and now - (lastTurnIn.time or 0) <= CHAIN_WINDOW then
    db.quest_prev[questId] = lastTurnIn.id
  end
end

-- ---- Loot ----
local function onLootOpened()
  local count = tonumber(safeCall(GetNumLootItems)) or 0
  local targetName = safeCall(UnitIsDead, "target") and safeCall(UnitName, "target") or nil
  local here = place()
  for slot = 1, count do
    local link = safeCall(GetLootSlotLink, slot)
    if link and isEquipment(link) then
      local guid = safeCall(GetLootSourceInfo, slot)
      local record = { type = "loot", from = targetName, npc_id = npcIdFromGuid(guid) }
      for key, value in pairs(here) do record[key] = value end
      remember(itemIdFromLink(link), record)
    end
  end
end

-- ---- Vendors ----
local function onBuy(index)
  local link = safeCall(GetMerchantItemLink, index)
  if not link or not isEquipment(link) then return end
  local vendor = npc() or {}
  local record = { type = "vendor", npc = vendor.name, npc_id = vendor.id }
  for key, value in pairs(place()) do record[key] = value end
  remember(itemIdFromLink(link), record)
end

if type(hooksecurefunc) == "function" then
  pcall(hooksecurefunc, "GetQuestReward", function(choice) pcall(onQuestReward, choice) end)
  pcall(hooksecurefunc, "BuyMerchantItem", function(index) pcall(onBuy, index) end)
end

local handlers = {
  QUEST_DETAIL = onQuestDetail,
  QUEST_COMPLETE = onQuestComplete,
  QUEST_TURNED_IN = onQuestTurnedIn,
  QUEST_ACCEPTED = onQuestAccepted,
  LOOT_OPENED = onLootOpened,
}
local events = CreateFrame("Frame")
for event in pairs(handlers) do pcall(events.RegisterEvent, events, event) end
events:SetScript("OnEvent", function(_, event, ...)
  local handler = handlers[event]
  if handler then pcall(handler, ...) end
end)

-- Read by the exporter: the record for an item ID, or nil.
function WFAArmorySourceFor(itemId)
  local db = WFAArmoryExportDB
  return db and db.sources and itemId and db.sources[tonumber(itemId)] or nil
end
