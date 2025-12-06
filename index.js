require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://b12-m11-session.web.app",
    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const db = client.db("LocalChefBazaar");
    const mealsCollection = db.collection("meals");
    // chef Api

    // PUBLIC GET — Meals with Sorting
    app.get("/meals", async (req, res) => {
      try {
        const sortOrder = req.query.sort === "desc" ? -1 : 1;
        // default = asc

        const meals = await mealsCollection
          .find()
          .sort({ price: sortOrder })
          .toArray();

        res.send({
          success: true,
          data: meals,
        });
      } catch (err) {
        console.error("Get Meals Error:", err);
        res.status(500).send({
          success: false,
          message: "Failed to fetch meals",
          error: err.message,
        });
      }
    });
    // Get single meal by ID
    app.get("/meals/:id", async (req, res) => {
      try {
        const { id } = req.params;

        // Find the meal by its ObjectId
        const meal = await mealsCollection.findOne({ _id: new ObjectId(id) });

        if (!meal) {
          return res.status(404).send({
            success: false,
            message: "Meal not found",
          });
        }

        res.send({
          success: true,
          data: meal,
        });
      } catch (err) {
        console.error("Get Single Meal Error:", err);
        res.status(500).send({
          success: false,
          message: "Failed to fetch meal",
          error: err.message,
        });
      }
    });

    app.post("/create-meals", async (req, res) => {
      try {
        const meal = req.body;

        // VALIDATE REQUIRED FIELDS
        const requiredFields = [
          "foodName",
          "chefName",
          "price",
          "rating",
          "ingredients",
          "estimatedDeliveryTime",
          "chefExperience",
          "userEmail",
          "chefId",
          "foodImage",
          "deliveryArea",
        ];

        for (const field of requiredFields) {
          if (!meal[field]) {
            return res.status(400).send({
              success: false,
              message: `Missing required field: ${field}`,
            });
          }
        }

        // FIX: ingredients must be array
        if (!Array.isArray(meal.ingredients)) {
          meal.ingredients = meal.ingredients.split(",").map((i) => i.trim());
        }

        // FIX: rating should not exceed 5
        meal.rating = Math.min(Number(meal.rating), 5);

        // AUTO ADD TIMESTAMP
        meal.createdAt = new Date();

        // INSERT INTO DB
        const result = await mealsCollection.insertOne(meal);

        res.status(201).send({
          success: true,
          message: "Meal created successfully!",
          data: result,
        });
      } catch (err) {
        console.error("Meal Create Error:", err);
        res.status(500).send({
          success: false,
          message: "Failed to create meal",
          error: err.message,
        });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
