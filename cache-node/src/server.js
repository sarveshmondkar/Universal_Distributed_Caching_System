import app from "./app.js"
import "dotenv/config"

const PORT = process.env.PORT || 4001

app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
});