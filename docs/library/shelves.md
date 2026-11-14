# Shelves

A shelf is a named, ordered list of movies and shows with a cover and a
description: *Christmas movies*, *Pixar*, *James Bond*, or the Marvel films in
story order. Shelves are curated once and browsed on the TV, where they get a
destination of their own next to Movies, Shows and Collections.

![The shelves page, with one cover card per shelf](screenshots/shelves-list.webp)

## Who can edit

Administrators create and edit shelves. Every signed-in user can browse them.
A shelf can sit behind a yearly window (for example November 1 to January 15),
and outside that window only administrators see it.

## Create a shelf

**Library → Shelves → New shelf** opens two ways in:

- **Start empty** with a name, then add titles.
- **Start from a recipe**: Christmas movies, Disney, Pixar, Studio Ghibli, James
  Bond, or the Marvel films in story order. A recipe fills the shelf once; from
  then on it is an ordinary shelf you can edit, and it never refreshes itself.

## Edit a shelf

![The shelf editor: its settings on the left, its titles in order on the right](screenshots/shelves-editor.webp)

- **Name and description** are what the TV shows above the shelf's titles.
- **Order** decides how the TV lists them: by hand (the order here, with the
  numbers on the cards), by release year, by rating, or by when each was added.
- **Show as a row on the TV's Home** puts the shelf on the TV's home screen.
  At most two shelves appear there, the first two that ask for it.
- **Yearly window** hides the shelf outside two month-and-day bounds. The
  Christmas preset fills in November 1 to January 15, which wraps the new year.
- **Cover** is a mosaic of the shelf's first four posters, one title's
  backdrop, or an image you upload (PNG, JPEG, GIF or WebP, up to 5 MB).
- **Titles** can be dragged into order (or moved with the arrow buttons),
  grouped under a header, and removed. A header sits above its title and the
  ones after it; renaming it renames the whole group, and it stays in place when
  titles move around it.
  **Add titles** searches the library first and TMDB for what it lacks, so a
  shelf can hold a film before it is requested.

## Rules

A shelf can also fill itself from rules over the library's title facts: types,
genres to include or exclude, keywords, companies, networks, a TMDB collection,
year range, minimum votes and rating, and certifications. Unset fields don't
filter. Keywords and companies are picked from a TMDB search, and saved ones show
their TMDB names.

- **Preview** lists what the current (unsaved) rules select, with the reason each
  title matches. Titles an exclusion rule removed are listed apart, and **Pin in**
  adds one by hand.
- **Seed from rules** adds the saved rules' current matches once. Titles you
  removed from the shelf stay out.
- **Auto-join** adds matching titles by itself as the library grows. It needs
  saved rules, and clearing the rules turns it off.
- Titles a rule added carry a **Rule** badge and the reason.
- Removing a title a rule added keeps it under **Removed titles**, so the rules
  never add it back; **Put back** returns it to the shelf.

## On the TV

The TV draws each shelf as a cover card and opens it into its titles. A title
the library has opens like any other; one it lacks stays in place, dimmed, with
a **Request** action. A show's season can sit on its own, between films.

Administrators also get **Add to shelf** in a library title's card menu on the
TV: it lists the shelves that take titles by hand, with a check on those already
holding the title.
