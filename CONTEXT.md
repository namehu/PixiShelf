# PixiShelf Archive Catalog

PixiShelf maintains a local, source-independent catalog of archived works and their ordered media. External sites describe where a work came from; they do not define the work's local identity.

## Catalog

**Artwork**:
A locally cataloged work containing ordered media, descriptive metadata, and user-curated state. An Artwork exists independently of any external site.
_Avoid_: Gallery, remote work, source item

**Media**:
An ordered image, animation, or video belonging to an Artwork.
_Avoid_: Page, file, image when referring to all supported media

**Source Provider**:
An external site that identifies and supplies archiveable works, such as Pixiv or E-Hentai.
_Avoid_: Source, import type, platform when the provider role is meant

**Source Reference**:
The identity linking an Artwork to one Source Provider. Its external identifier is unique only within that provider.
_Avoid_: External ID by itself, source ID by itself

**Creation Method**:
The way an Artwork first entered PixiShelf, such as a source scan, URL archive, local directory import, or manual creation. It is independent of Source Provider.
_Avoid_: Source

**Storage Key**:
An immutable PixiShelf-assigned identifier used to keep a locally created or imported Artwork stable in storage. It is never a remote identity.
_Avoid_: External ID, provider ID

## Archiving

**Archive Import**:
A user-requested attempt to resolve a source URL and preserve its work, metadata, and media in PixiShelf.
_Avoid_: Scan, download when referring to the whole operation

**Archive Item**:
One ordered remote media entry tracked by an Archive Import.
_Avoid_: Image when its media type is not yet known

**Archive Revision**:
An immutable snapshot of an archived work at a point in time. The latest published revision is shown by default while earlier revisions remain recoverable.
_Avoid_: Version when referring to application releases

**Source Snapshot**:
The source-provided metadata observed during an Archive Import or update check.
_Avoid_: Artwork metadata when it may include local edits

**Published Archive**:
An Archive Revision whose required media and manifest have passed validation and are visible in the catalog.
_Avoid_: Completed download

## Curation

**Local Override**:
An intentional user edit that takes precedence over a later Source Snapshot without erasing the source-provided value.
_Avoid_: Manual metadata

**Source Tag**:
A tag assignment supplied by a particular Source Reference. Refreshing that source may replace its Source Tags but never user-curated or derived tags.
_Avoid_: Imported tag when its provenance matters

**Uploader**:
The source account that published a remote gallery. An Uploader is not assumed to be the Artwork's creator.
_Avoid_: Artist, creator

**Unknown Origin**:
An existing Artwork whose source identity cannot be established from trustworthy evidence. PixiShelf preserves it without guessing a Source Provider.
_Avoid_: Pixiv by default
