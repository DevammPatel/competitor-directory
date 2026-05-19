const axios = require('axios');
const API_KEY = process.env.APIFY_API_KEY || 'YOUR_APIFY_API_KEY';

async function run() {
  const actorId = 'harvestapi/linkedin-profile-posts'.replace("/", "~");
  try {
    const response = await axios.post(
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`,
      {
        profileUrls: ["https://www.linkedin.com/in/williamhgates/"],
        maxPosts: 5,
        postedLimit: "week",
        scrapeReactions: false,
        scrapeComments: false
      },
      {
        params: { token: API_KEY },
        headers: { "Content-Type": "application/json" }
      }
    );
    console.log(JSON.stringify(response.data[0], null, 2));
  } catch(e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
run();
