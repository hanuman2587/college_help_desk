import { MongoClient } from "mongodb";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import path from "path";
import { fileURLToPath } from "url";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mongoClient = null;
const getMongoClient = async () => {
   if (!mongoClient) {
       mongoClient = new MongoClient(process.env.MONGODB_URI || "");
       await mongoClient.connect();
   }
   return mongoClient;
};

const getEmbeddings = () => {
   if (!process.env.GOOGLE_API_KEY) {
       throw new Error("GOOGLE_API_KEY is not set in .env!");
   }
   return new GoogleGenerativeAIEmbeddings({
       apiKey: process.env.GOOGLE_API_KEY,
       model: "gemini-embedding-001",
   });
};

const getVectorStore = async () => {
   const client = await getMongoClient();
   const collection = client.db("edureach_db").collection("knowledge_docs");
   return new MongoDBAtlasVectorSearch(getEmbeddings(), {
       collection: collection,
       indexName: "edureach_vector_index",
       textKey: "text",
       embeddingKey: "embedding",
   });
};
export const initializeKnowledgeBase = async () => {
    const client = await getMongoClient();
    const collection = client.db("edureach_db").collection("knowledge_docs");

    // Check if docs exist WITH valid (non-empty) embeddings
    const docWithEmbedding = await collection.findOne({
        embedding: { $exists: true, $not: { $size: 0 } },
    });

    if (docWithEmbedding) {
        const count = await collection.countDocuments();
        console.log(` Knowledge base ready (${count} chunks with embeddings)`);
        return;
    }

    // Delete old chunks before re-indexing
    await collection.deleteMany({});
    console.log(" Indexing knowledge base...");

    // Initialize the embedding model and validate the API key
    const embeddings = getEmbeddings();
    try {
        const testResult = await embeddings.embedQuery("test");
        console.log(` API key OK — embedding dimensions: ${testResult.length}`);
    } catch (error) {
        console.error(" Embedding test failed!");
        console.error("   Error:", error.message || error);
        console.error("   Get key from: https://aistudio.google.com/apikey");
        throw error;
    }

    // Read the college data and validate content
    const filePath = path.join(__dirname, "../../knowledge-base/edureach-knowledge.txt");
    const loader = new TextLoader(filePath);
    const docs = await loader.load();
    if(docs.length === 0) {
        throw new Error("No documents found in knowledge base file");
    }
    const totalCharacters = docs.reduce((sum, doc) => sum + doc.pageContent.length, 0);
    console.log(`    Loaded ${totalCharacters} characters`);

    // Split into smaller chunks
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
    });
    const allSplits = await splitter.splitDocuments(docs);
    console.log(`    Split into ${allSplits.length} chunks`);

    // Convert chunks to embeddings and store them
    const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
        collection: collection,
        indexName: "edureach_vector_index",
        textKey: "text",
        embeddingKey: "embedding",
    });
    await vectorStore.addDocuments(allSplits);

    // Verify the stored embeddings
    const verifyDoc = await collection.findOne({
        embedding: { $exists: true, $not: { $size: 0 } },
    });
    if (verifyDoc && Array.isArray(verifyDoc.embedding) && verifyDoc.embedding.length > 0) {
        console.log(`    ${allSplits.length} chunks stored (${verifyDoc.embedding.length}D embeddings)`);
        console.log(`     IMPORTANT: Create Atlas Vector Search index with numDimensions: ${verifyDoc.embedding.length}`);
    } else {
        await collection.deleteMany({});
        throw new Error(" Embeddings are empty! Google API returned no vectors.");
    }
};

export const getRAGResponse = async (question) => {
    try {
        const vectorStore = await getVectorStore();

        // RETRIEVE: Search for the 3 most relevant chunks
        const retrievedDocs = await vectorStore.similaritySearch(question, 3);

        if (retrievedDocs.length === 0) {
            return "I don't have that information right now. Please contact the college office for assistance.";
        }

        // AUGMENT: Combine retrieved chunks into a single context string
        const context = retrievedDocs
            .map((doc) => doc.pageContent)
            .join("\n\n");

        // GENERATE: Send context + question to AI for a natural answer
        const model = new ChatGoogleGenerativeAI({
            model: "gemini-2.5-flash",
            apiKey: process.env.GOOGLE_API_KEY,
            temperature: 0.7,
        });

        const result = await model.invoke([
            {
                role: "system",
                content: `You are EduReach Bot, a helpful college assistant. 
Answer questions based ONLY on the following context. 
If the answer is not in the context, say you don't have that information.
Be friendly, concise, and accurate.

Context:
${context}`,
            },
            { role: "user", content: question },
        ]);

        return result.content;
    } catch (error) {
        console.error(`[RAG] EXCEPTION:, ${error.message}`);
        return "I'm having trouble right now. Please try again or contact the college office for assistance.";
    }
};