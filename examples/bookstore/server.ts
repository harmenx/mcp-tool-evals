import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";

interface Book {
  id: string;
  title: string;
  author: string;
  price: number;
  tag: string;
  inStock: boolean;
}

const BOOKS: Book[] = [
  { id: "dune", title: "Dune", author: "Frank Herbert", price: 9.99, tag: "sci-fi", inStock: true },
  { id: "neuromancer", title: "Neuromancer", author: "William Gibson", price: 12.5, tag: "sci-fi", inStock: true },
  {
    id: "left-hand",
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    price: 11,
    tag: "sci-fi",
    inStock: false,
  },
  {
    id: "name-of-the-wind",
    title: "The Name of the Wind",
    author: "Patrick Rothfuss",
    price: 14,
    tag: "fantasy",
    inStock: true,
  },
];

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

function formatBook(book: Book): string {
  const stock = book.inStock ? "in stock" : "out of stock";
  return `${book.title} by ${book.author} — ${formatPrice(book.price)} (${stock}) [id=${book.id}]`;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1000) / 1000);
}

export function createBookstore(): McpServer {
  const server = new McpServer({ name: "bookstore", version: "1.0.0" });

  server.registerTool(
    "search_books",
    {
      title: "Search books",
      description: "Search the catalog by title or author. Returns matching books with price and whether each one is in stock.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Title or author text to search for, for example Dune"),
      }),
    },
    async ({ query }) => {
      const needle = query.toLowerCase();
      const matches = BOOKS.filter(
        (book) => book.title.toLowerCase().includes(needle) || book.author.toLowerCase().includes(needle),
      );
      const text = matches.length === 0 ? `No books matched "${query}".` : matches.map(formatBook).join("\n");
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.registerTool(
    "get_book",
    {
      title: "Get book",
      description: "Look up one catalog book by its id.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Book id, for example dune"),
      }),
    },
    async ({ id }) => {
      const book = BOOKS.find((entry) => entry.id === id);
      if (!book) {
        return { content: [{ type: "text" as const, text: `No book with id "${id}".` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: formatBook(book) }] };
    },
  );

  server.registerTool(
    "list_by_tag",
    {
      title: "List books by tag",
      description: "List catalog books with an exact tag. Tags in this catalog are sci-fi and fantasy.",
      inputSchema: z.object({
        tag: z.string().min(1).describe("Tag to match, for example sci-fi"),
      }),
    },
    async ({ tag }) => {
      const matches = BOOKS.filter((book) => book.tag.toLowerCase() === tag.toLowerCase());
      const text = matches.length === 0 ? `No books tagged "${tag}".` : matches.map(formatBook).join("\n");
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.registerTool(
    "calculate",
    {
      title: "Calculate",
      description: "Add or multiply two numbers. Use this for arithmetic, not for catalog questions.",
      inputSchema: z.object({
        op: z.enum(["add", "mul"]).describe("add sums the operands; mul multiplies them"),
        a: z.number().describe("First operand"),
        b: z.number().describe("Second operand"),
      }),
    },
    async ({ op, a, b }) => {
      const value = op === "add" ? a + b : a * b;
      return { content: [{ type: "text" as const, text: formatNumber(value) }] };
    },
  );

  return server;
}

function serveHttp(port: number): Promise<void> {
  const handler = createMcpHandler(() => createBookstore());
  const nodeHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const http = createServer((req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    void nodeHandler(req, res);
  });

  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, "127.0.0.1", () => {
      const address = http.address();
      const bound = address && typeof address === "object" ? address.port : port;
      console.error(`listening ${bound}`);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const httpFlag = process.argv.indexOf("--http");
  if (httpFlag !== -1) {
    const raw = process.argv[httpFlag + 1] ?? "0";
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 0) {
      throw new Error(`Expected a port after --http, received ${raw}`);
    }
    await serveHttp(port);
    return;
  }

  serveStdio(createBookstore);
  console.error("bookstore mcp server on stdio");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
