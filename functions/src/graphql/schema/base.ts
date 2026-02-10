/**
 * Base GraphQL Schema
 * Contentful-compatible types that are always available
 */

export const baseSchema = `
  """
  ISO 8601 date-time string
  """
  scalar DateTime

  """
  Arbitrary JSON value
  """
  scalar JSON

  """
  Geographic location with latitude and longitude
  """
  type Location {
    lat: Float!
    lon: Float!
  }

  """
  Link type for references
  """
  type Link {
    """Link type (e.g., 'Link')"""
    type: String!
    
    """Type of resource being linked (e.g., 'ContentType', 'Space', 'Environment')"""
    linkType: String!
    
    """ID of the linked resource"""
    id: String!
  }

  """
  System metadata for all resources
  """
  type Sys {
    """Unique identifier"""
    id: String!
    
    """Space ID"""
    spaceId: String!
    
    """Environment ID"""
    environmentId: String!
    
    """Content Type reference (for entries)"""
    contentType: Link
    
    """Date-time when the resource was published"""
    publishedAt: DateTime
    
    """Date-time when the resource was first published"""
    firstPublishedAt: DateTime
    
    """Version number of the published resource"""
    publishedVersion: Int
  }

  """
  Contentful metadata (tags, concepts, etc.)
  """
  type ContentfulMetadata {
    """Public tags associated with the resource"""
    tags: [ContentfulTag]!
  }

  """
  Tag definition
  """
  type ContentfulTag {
    """Tag ID"""
    id: String!
    
    """Tag name"""
    name: String!
  }

  """
  System filter for querying by sys fields
  """
  input SysFilter {
    id: String
    id_not: String
    id_in: [String]
    id_not_in: [String]
    id_contains: String
    id_not_contains: String
    id_exists: Boolean
    
    publishedAt: DateTime
    publishedAt_gt: DateTime
    publishedAt_gte: DateTime
    publishedAt_lt: DateTime
    publishedAt_lte: DateTime
    publishedAt_in: [DateTime]
    publishedAt_not_in: [DateTime]
    publishedAt_exists: Boolean
    
    firstPublishedAt: DateTime
    firstPublishedAt_gt: DateTime
    firstPublishedAt_gte: DateTime
    firstPublishedAt_lt: DateTime
    firstPublishedAt_lte: DateTime
    firstPublishedAt_in: [DateTime]
    firstPublishedAt_not_in: [DateTime]
    firstPublishedAt_exists: Boolean
  }

  """
  Contentful metadata filter
  """
  input ContentfulMetadataFilter {
    tags_exists: Boolean
    tags: ContentfulMetadataTagsFilter
  }

  """
  Tags filter
  """
  input ContentfulMetadataTagsFilter {
    id_contains_some: [String!]
    id_contains_none: [String!]
    id_contains_all: [String!]
  }

  """
  Generic Entry interface
  All content types implement this interface
  """
  interface Entry {
    sys: Sys!
    contentfulMetadata: ContentfulMetadata
  }

  """
  Collection of entries (generic)
  """
  type EntryCollection {
    skip: Int!
    limit: Int!
    total: Int!
    items: [Entry]!
  }

  """
  Order enum for generic entries
  """
  enum EntryOrder {
    sys_id_ASC
    sys_id_DESC
    sys_publishedAt_ASC
    sys_publishedAt_DESC
    sys_firstPublishedAt_ASC
    sys_firstPublishedAt_DESC
  }

  """
  Image transformation options
  """
  input ImageTransformOptions {
    """Desired width in pixels (1-4000)"""
    width: Int
    
    """Desired height in pixels (1-4000)"""
    height: Int
    
    """Desired quality (1-100) for JPG, PNG8, WEBP"""
    quality: Int
    
    """Corner radius in pixels (-1 for full circle)"""
    cornerRadius: Int
    
    """Resize strategy"""
    resizeStrategy: ImageResizeStrategy
    
    """Focus area for cropping"""
    resizeFocus: ImageResizeFocus
    
    """Background color in rgb:ffffff format"""
    backgroundColor: String
    
    """Output format"""
    format: ImageFormat
  }

  """
  Image resize strategy
  """
  enum ImageResizeStrategy {
    """Fit into dimensions"""
    FIT
    
    """Pad to dimensions"""
    PAD
    
    """Fill dimensions (crop if needed)"""
    FILL
    
    """Scale to dimensions (change aspect ratio)"""
    SCALE
    
    """Crop to dimensions"""
    CROP
    
    """Create thumbnail"""
    THUMB
  }

  """
  Image resize focus area
  """
  enum ImageResizeFocus {
    CENTER
    TOP
    RIGHT
    LEFT
    BOTTOM
    TOP_RIGHT
    TOP_LEFT
    BOTTOM_RIGHT
    BOTTOM_LEFT
    FACE
    FACES
  }

  """
  Image output format
  """
  enum ImageFormat {
    JPG
    JPG_PROGRESSIVE
    PNG
    PNG8
    WEBP
  }

  """
  Asset type
  """
  type Asset {
    sys: Sys!
    contentfulMetadata: ContentfulMetadata
    
    """Asset title"""
    title(locale: String): String
    
    """Asset description"""
    description(locale: String): String
    
    """MIME type"""
    contentType(locale: String): String
    
    """Original filename"""
    fileName(locale: String): String
    
    """File size in bytes"""
    size(locale: String): Int
    
    """Image width in pixels (images only)"""
    width(locale: String): Int
    
    """Image height in pixels (images only)"""
    height(locale: String): Int
    
    """Asset URL with optional transformations"""
    url(transform: ImageTransformOptions, locale: String): String
  }

  """
  Collection of assets
  """
  type AssetCollection {
    skip: Int!
    limit: Int!
    total: Int!
    items: [Asset]!
  }

  """
  Asset filter
  """
  input AssetFilter {
    sys: SysFilter
    contentfulMetadata: ContentfulMetadataFilter
    
    title: String
    title_not: String
    title_in: [String]
    title_not_in: [String]
    title_contains: String
    title_not_contains: String
    title_exists: Boolean
    
    description: String
    description_not: String
    description_in: [String]
    description_not_in: [String]
    description_contains: String
    description_not_contains: String
    description_exists: Boolean
    
    contentType: String
    contentType_not: String
    contentType_in: [String]
    contentType_not_in: [String]
    contentType_contains: String
    contentType_not_contains: String
    contentType_exists: Boolean
    
    fileName: String
    fileName_not: String
    fileName_in: [String]
    fileName_not_in: [String]
    fileName_contains: String
    fileName_not_contains: String
    fileName_exists: Boolean
    
    size: Int
    size_gt: Int
    size_gte: Int
    size_lt: Int
    size_lte: Int
    size_in: [Int]
    size_not_in: [Int]
    size_exists: Boolean
    
    width: Int
    width_gt: Int
    width_gte: Int
    width_lt: Int
    width_lte: Int
    width_in: [Int]
    width_not_in: [Int]
    width_exists: Boolean
    
    height: Int
    height_gt: Int
    height_gte: Int
    height_lt: Int
    height_lte: Int
    height_in: [Int]
    height_not_in: [Int]
    height_exists: Boolean
    
    url: String
    url_not: String
    url_in: [String]
    url_not_in: [String]
    url_contains: String
    url_not_contains: String
    url_exists: Boolean
    
    AND: [AssetFilter]
    OR: [AssetFilter]
  }

  """
  Asset order
  """
  enum AssetOrder {
    sys_id_ASC
    sys_id_DESC
    sys_publishedAt_ASC
    sys_publishedAt_DESC
    sys_firstPublishedAt_ASC
    sys_firstPublishedAt_DESC
    title_ASC
    title_DESC
    fileName_ASC
    fileName_DESC
    size_ASC
    size_DESC
    width_ASC
    width_DESC
    height_ASC
    height_DESC
  }

  """
  Root Query type
  Dynamic content type queries are added at runtime
  """
  type Query {
    """Fetch a single asset by ID"""
    asset(id: String!, preview: Boolean, locale: String): Asset
    
    """Fetch collection of assets"""
    assetCollection(
      skip: Int
      limit: Int
      preview: Boolean
      locale: String
      where: AssetFilter
      order: [AssetOrder]
    ): AssetCollection
    
    """Fetch collection of entries across all content types"""
    entryCollection(
      skip: Int
      limit: Int
      preview: Boolean
      locale: String
      order: [EntryOrder]
    ): EntryCollection
  }
`;

