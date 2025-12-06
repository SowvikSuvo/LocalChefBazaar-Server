require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
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
    origin: [process.env.CLIENT_URL],
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
    // const usersCollection = db.collection("users");
    const db = client.db("LocalChefBazaar");
    const mealsCollection = db.collection("meals");
    const reviewsCollection = db.collection("review");
    const favoritesCollection = db.collection("favorite");
    const ordersCollection = db.collection("orders");

    // payment endpoint
    app.post("/create-checkout-session", verifyJWT, async (req, res) => {
      const paymentInfo = req.body;
      console.log(paymentInfo);
      const paymentAmount = parseInt(paymentInfo?.order?.price) * 100;
      res.send(paymentInfo);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `Please pay for: ${paymentInfo?.order?.mealName}`,
              },
              unit_amount: paymentAmount,
            },
            quantity: paymentInfo?.order?.quantity,
          },
        ],
        customer_email: paymentInfo?.userEmail,
        mode: "payment",
        meta_data: {
          orderId: paymentInfo?.order?._id,
          userEmail: paymentInfo?.userEmail,
          userAddress: paymentInfo?.order?.userAddress,
        },
        success_url: `${process.env.CLIENT_URL}/payment-success`,
      });
    });

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

    // GET /reviews/:foodId
    app.get("/reviews/:foodId", async (req, res) => {
      try {
        const { foodId } = req.params;
        const reviews = await reviewsCollection
          .find({ foodId })
          .sort({ date: -1 })
          .toArray();
        res.send({ success: true, data: reviews });
      } catch (err) {
        console.error(err);
        res.status(500).send({
          success: false,
          message: "Failed to fetch reviews",
          error: err.message,
        });
      }
    });

    app.post("/orders", async (req, res) => {
      try {
        const orderData = req.body;
        const result = await ordersCollection.insertOne(orderData);

        res.send({
          success: true,
          message: "Order placed successfully!",
          orderId: result.insertedId,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({
          success: false,
          message: "Failed to place order",
        });
      }
    });

    // POST /reviews
    app.post("/reviews", async (req, res) => {
      try {
        const review = req.body; // { foodId, reviewerName, reviewerImage, rating, comment, date }

        if (
          !review.foodId ||
          !review.reviewerName ||
          !review.rating ||
          !review.comment
        ) {
          return res
            .status(400)
            .send({ success: false, message: "Missing required fields!" });
        }

        const result = await reviewsCollection.insertOne(review);
        res.send({
          success: true,
          message: "Review submitted successfully!",
          data: result,
        });
      } catch (err) {
        console.error(err);
        res.status(500).send({
          success: false,
          message: "Failed to submit review",
          error: err.message,
        });
      }
    });

    // POST /favorites
    app.post("/favorites", async (req, res) => {
      try {
        const favorite = req.body; // { userEmail, mealId, mealName, chefId, chefName, price, addedTime }

        // Check if already in favorites
        const exists = await favoritesCollection.findOne({
          userEmail: favorite.userEmail,
          mealId: favorite.mealId,
        });
        if (exists)
          return res.send({
            success: false,
            message: "Meal already in favorites!",
          });

        const result = await favoritesCollection.insertOne(favorite);
        res.send({
          success: true,
          message: "Added to favorites!",
          data: result,
        });
      } catch (err) {
        console.error(err);
        res.status(500).send({
          success: false,
          message: "Failed to add favorite",
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
          "chefId", // original full UID from client
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

        // SHORTEN chefId
        meal.chefId = `chef_${meal.chefId.slice(0, 6)}`; // <-- short version

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

    // GET /orders?userEmail=user@example.com
    app.get("/orders", verifyJWT, async (req, res) => {
      try {
        const userEmail = req.query.userEmail;

        if (req.tokenEmail !== userEmail) {
          return res.status(403).send({ success: false, message: "Forbidden" });
        }

        const orders = await ordersCollection
          .find({ userEmail })
          .sort({ orderTime: -1 })
          .toArray();

        res.send({
          success: true,
          data: orders, // <--- frontend expects response.data.data
        });
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .send({ success: false, message: "Failed to fetch orders" });
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
