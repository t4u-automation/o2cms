/**
 * Convert a string to a slug format (camelCase for API IDs)
 * e.g., "Blog Post" -> "blogPost", "Product Category" -> "productCategory"
 */
export function slugifyToApiId(text: string): string {
  return text
    .trim()
    .split(/\s+/) // Split by whitespace
    .map((word, index) => {
      // Remove non-alphanumeric characters
      const cleaned = word.replace(/[^a-zA-Z0-9]/g, "");
      if (!cleaned) return "";
      
      // First word lowercase, rest capitalize first letter
      if (index === 0) {
        return cleaned.charAt(0).toLowerCase() + cleaned.slice(1).toLowerCase();
      }
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
    })
    .filter(Boolean) // Remove empty strings
    .join("");
}

/**
 * Convert a string to kebab-case
 * e.g., "Blog Post" -> "blog-post"
 */
export function slugifyToKebabCase(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
}

/**
 * Convert a string to snake_case
 * e.g., "Blog Post" -> "blog_post"
 */
export function slugifyToSnakeCase(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, "") // Remove special characters
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .replace(/_+/g, "_") // Replace multiple underscores with single underscore
    .replace(/^_+|_+$/g, ""); // Remove leading/trailing underscores
}

