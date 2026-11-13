# Entities and the house

Crackerbox is a workshop for vibe coding with a small crew of AI helpers. This page explains how the crew works.

## Entities

An **entity** is an AI crew member. Each one has:

- **A room.** A project of its own (a normal Crackerbox app). Click its circle in the left bar and you are in its room, talking to it.
- **A personality.** Written in the `AI_RULES.md` file in its room. You describe it when you create it, and you can edit the file any time.
- **Its own memory.** Things it decides are worth remembering about you and your work. Other entities cannot read it.
- **A color and a face.** Its circle in the left bar. Pick a color when you create it; a face picture can be added later.

To add one, click the **+** under the circles in the left bar, give it a name, pick a color, and describe it in a sentence or two. That is it. Entities are protected from accidental deletion.

The tabs along the top are **jobs**: one chat per job, each tagged with the entity doing it.

## The house

The entities live together in "the house". That is what lets them work as a crew instead of as separate chatbots:

- **Notes between entities.** One entity can leave a note in another's mailbox ("Quill, here is how the recipe data is shaped, write your copy to fit"). The other finds it next time it is active.
- **Shared notes.** A few small notes everyone can read and add to: house rules, shared facts about you.
- **Who lives here.** Any entity can look up the roster.

You can read all of it. The house lives in Crackerbox's data folder under `house/`.

## Optional extras

These work today but are set up by editing a small file, not by a button:

- **Scheduled check-ins.** Wake an entity at a set time (a daily greeting) or on a dice roll (a surprise check-in). Those chats run silently and stay out of your chat list. Config: `house/schedule.json`.
- **Telegram.** Give each entity its own Telegram bot and you can message it from your phone. Put the bot token and your chat id in its project's `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`), then switch it on in `house/telegram.json`. Only your chat id is ever accepted.
- **Plugins.** Entities can use the same plugin (MCP) tools as everything else in Crackerbox.

## Straight talk

Crackerbox is built around one person's taste. Feedback and ideas are welcome, but an idea only goes in if it fits what Crackerbox is for. If it does not, it does not, and that is nothing personal.
