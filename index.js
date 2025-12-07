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
    const db = client.db("LocalChefBazaar");
    const usersCollection = db.collection("users");
    const mealsCollection = db.collection("meals");
    const reviewsCollection = db.collection("review");
    const favoritesCollection = db.collection("favorite");
    const ordersCollection = db.collection("orders");
    const paymentCollection = db.collection("payments");
    const adminRequestsCollection = db.collection("adminRequests");

    const verifyAdmin = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }

      next();
    };

    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection
          .find()
          .sort({ displayName: 1 })
          .toArray();
        res.send(users);
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .send({ success: false, message: "Failed to fetch users" });
      }
    });

    // Mark user as fraud
    app.patch(
      "/users/fraud/:email",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const { email } = req.params;

          const user = await usersCollection.findOne({ email });

          if (!user) {
            return res
              .status(404)
              .send({ success: false, message: "User not found" });
          }

          if (user.role === "admin") {
            return res.status(403).send({
              success: false,
              message: "Cannot mark an admin as fraud",
            });
          }

          if (user.status === "fraud") {
            return res.status(400).send({
              success: false,
              message: "User is already marked as fraud",
            });
          }

          await usersCollection.updateOne(
            { email },
            { $set: { status: "fraud" } }
          );

          res.send({
            success: true,
            message: `${user.displayName} is now marked as fraud.`,
          });
        } catch (err) {
          console.error(err);
          res.status(500).send({
            success: false,
            message: "Failed to mark fraud",
            error: err.message,
          });
        }
      }
    );

    app.post("/users", async (req, res) => {
      const user = req.body;

      try {
        const existingUser = await usersCollection.findOne({ uid: user.uid });
        if (existingUser) return res.send({ message: "User already exists" });

        const newUser = {
          uid: user.uid,
          displayName: user.name || user.displayName,
          email: user.email,
          address: user.address || "",
          photoURL: user.image || user.photoURL,
          role: "user",
          status: "active",
        };

        const result = await usersCollection.insertOne(newUser);
        res.status(201).send(result);
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .send({ message: "Failed to create user", error: err.message });
      }
    });

    app.get("/user/role/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      if (!result) {
        return res.status(404).send({ message: "User not found" });
      }
      res.send({ role: result?.role });
    });

    app.patch("/users/role/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const updateData = req.body; // { role, chefId? }

        const result = await usersCollection.updateOne(
          { email },
          { $set: updateData }
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .send({ message: "User not found or already updated" });
        }

        res.send({ success: true, message: "User role updated successfully!" });
      } catch (err) {
        console.error(err);
        res.status(500).send({
          success: false,
          message: "Failed to update user role",
          error: err.message,
        });
      }
    });

    app.get("/users/:uid", async (req, res) => {
      try {
        const { uid } = req.params;
        const user = await usersCollection.findOne({ uid });
        if (!user) return res.status(404).send({ message: "User not found" });
        res.send(user);
      } catch (err) {
        res
          .status(500)
          .send({ message: "Failed to fetch user", error: err.message });
      }
    });

    app.post("/admin/requests", async (req, res) => {
      try {
        const { userName, userEmail, requestType } = req.body;

        console.log("Body:", req.body);

        if (!userName || !userEmail || !requestType) {
          return res.status(400).send({
            success: false,
            message: "Missing required fields",
          });
        }

        const newRequest = {
          userName,
          userEmail,
          requestType,
          requestStatus: "pending",
          requestTime: new Date(),
        };

        const result = await adminRequestsCollection.insertOne(newRequest);

        res.send({
          success: true,
          message: "Request submitted!",
          data: result,
        });
      } catch (err) {
        console.error("Error in /admin/requests ->", err);
        res.status(500).send({
          success: false,
          message: "Server error",
          error: err.message,
        });
      }
    });

    app.get("/admin/requests", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const requests = await adminRequestsCollection
          .find()
          .sort({ requestTime: -1 }) // latest first
          .toArray();

        res.send(requests);
      } catch (error) {
        console.error("Error fetching requests:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // payment endpoint
    app.post("/create-checkout-session", verifyJWT, async (req, res) => {
      try {
        const paymentInfo = req.body;
        console.log("Received Payment Info:", paymentInfo);

        const paymentAmount = parseInt(paymentInfo?.order?.price) * 100;

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
              quantity: paymentInfo?.order?.quantity || 1,
            },
          ],
          customer_email: paymentInfo?.userEmail,
          mode: "payment",
          metadata: {
            userEmail: paymentInfo?.userEmail,
            userAddress: paymentInfo?.order?.userAddress,
            chefId: paymentInfo?.order?.chefId,
            foodId: paymentInfo?.order?.foodId,
            orderId: paymentInfo?.order?._id?.toString(),
            paymentStatus: "pending",
            chefName: paymentInfo?.order?.chefName,
            mealName: paymentInfo?.order?.mealName,
            deliveryTime: paymentInfo?.order?.estimatedDeliveryTime,
            orderStatus: "pending",
          },
          success_url: `${process.env.CLIENT_URL}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_URL}/dashboard/my-orders`,
        });

        return res.send({ url: session.url });
      } catch (err) {
        console.error("Stripe Error:", err);
        return res.status(500).json({ error: err.message });
      }
    });

    app.post("/payment-success", async (req, res) => {
      try {
        const { sessionId } = req.body;

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res
            .status(400)
            .send({ success: false, message: "Payment not completed!" });
        }

        const metadata = session.metadata;

        const paymentRecord = {
          foodId: metadata.foodId,
          chefId: metadata.chefId,
          userEmail: metadata.userEmail,
          transactionId: session.payment_intent,
          paymentStatus: "paid",
          orderStatus: "pending",
          amountPaid: session.amount_total / 100,
          quantity: Number(metadata.quantity),
          mealName: metadata.mealName,
          chefName: metadata.chefName,
          userAddress: metadata.userAddress,
          paymentDate: new Date(),
        };

        await paymentCollection.insertOne(paymentRecord);

        await ordersCollection.updateOne(
          { _id: new ObjectId(metadata.orderId) },
          { $set: { paymentStatus: "paid" } }
        );

        res.send({
          success: true,
          message: "Payment stored and order updated successfully!",
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({
          success: false,
          message: "Failed to save payment!",
          error: error.message,
        });
      }
    });

    // chef Api

    app.get("/my-meals/:email", async (req, res) => {
      try {
        const email = req.params.email;

        const meals = await mealsCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.send({ success: true, data: meals });
      } catch (error) {
        console.error(error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch meals",
        });
      }
    });

    app.delete("/meals/:id", async (req, res) => {
      try {
        const result = await mealsCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });

        res.send({
          success: true,
          message: "Meal deleted successfully",
        });
      } catch (err) {
        res.status(500).send({
          success: false,
          message: "Failed to delete meal",
          error: err.message,
        });
      }
    });
    
    app.patch("/meals/:id", async (req, res) => {
      try {
        const updateData = req.body;

        const result = await mealsCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: updateData }
        );

        res.send({
          success: true,
          message: "Meal updated successfully",
        });
      } catch (err) {
        res.status(500).send({
          success: false,
          message: "Failed to update meal",
          error: err.message,
        });
      }
    });

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

        // Check if the user is marked as fraud
        const user = await usersCollection.findOne({
          email: orderData.userEmail,
        });
        if (!user) {
          return res
            .status(404)
            .send({ success: false, message: "User not found" });
        }
        if (user.status === "fraud" && user.role === "user") {
          return res.status(403).send({
            success: false,
            message: "You are marked as fraud and cannot place orders",
          });
        }

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

    app.patch("/admin/requests/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { action, email, requestType } = req.body;

        // Reject Request
        if (action === "reject") {
          await adminRequestsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { requestStatus: "rejected" } }
          );

          return res.send({
            success: true,
            message: "Request rejected successfully!",
          });
        }

        // Accept Request
        if (action === "accept") {
          let updateRole = {};

          if (requestType === "chef") {
            const randomId = Math.floor(1000 + Math.random() * 9000);
            updateRole = {
              role: "chef",
              chefId: `chef-${randomId}`,
            };
          } else if (requestType === "admin") {
            updateRole = {
              role: "admin",
            };
          }

          const userUpdate = await usersCollection.updateOne(
            { email: email }, // MUST match userEmail from frontend
            { $set: updateRole }
          );

          if (!userUpdate.modifiedCount) {
            return res.send({
              success: false,
              message: "User role update failed — email not found!",
            });
          }

          // Update request status
          await adminRequestsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { requestStatus: "approved" } }
          );

          return res.send({
            success: true,
            message: "Request approved successfully!",
          });
        }
      } catch (err) {
        console.error(err);
        res.status(500).send({
          success: false,
          message: "Failed to update request",
          error: err.message,
        });
      }
    });

    // Get all orders for the logged-in chef
    app.get("/orders/by-chef/:chefId", async (req, res) => {
      const chefId = req.params.chefId;

      // Show only orders where chefId matches logged-in chef
      const orders = await ordersCollection.find({ chefId }).toArray();

      res.send(orders);
    });

    app.patch("/orders/status/:id", async (req, res) => {
      const id = req.params.id;
      const { orderStatus } = req.body;

      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { orderStatus } }
      );

      res.send(result);
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
        const favorite = req.body;

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

        const chef = await usersCollection.findOne({ email: meal.userEmail });
        if (!chef) {
          return res
            .status(404)
            .send({ success: false, message: "Chef not found" });
        }
        if (chef.status === "fraud" && chef.role === "chef") {
          return res.status(403).send({
            success: false,
            message: "You are marked as fraud and cannot create meals",
          });
        }

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

        meal.chefId = `chef_${meal.chefId.slice(0, 6)}`;

        if (!Array.isArray(meal.ingredients)) {
          meal.ingredients = meal.ingredients.split(",").map((i) => i.trim());
        }

        meal.rating = Math.min(Number(meal.rating), 5);
        meal.createdAt = new Date();

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
          data: orders,
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
