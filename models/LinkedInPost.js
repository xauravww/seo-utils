import mongoose from "mongoose";

// Define available categories for LinkedIn posts
const CATEGORIES = {
  JOB_POSTING: "job_posting",
  CAREER_ADVICE: "career_advice",
  TECHNICAL_TUTORIAL: "technical_tutorial",
  COMPANY_NEWS: "company_news",
  INDUSTRY_INSIGHTS: "industry_insights",
  NETWORKING: "networking",
  PERSONAL_ACHIEVEMENT: "personal_achievement",
  PRODUCT_LAUNCH: "product_launch",
  RECRUITMENT: "recruitment",
  EDUCATIONAL_CONTENT: "educational_content",
  THOUGHT_LEADERSHIP: "thought_leadership",
  EVENT_ANNOUNCEMENT: "event_announcement",
  TEAM_COLLABORATION: "team_collaboration",
  TECHNOLOGY_TRENDS: "technology_trends",
  STARTUP_NEWS: "startup_news",
  UNCATEGORIZED: "uncategorized",
};

// Define the schema for LinkedIn posts
const linkedInPostSchema = new mongoose.Schema(
  {
    backend_urn: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    author_name: {
      type: String,
      required: true,
      trim: true,
    },
    author_description: {
      type: String,
      default: null,
      trim: true,
    },
    post_text: {
      type: String,
      required: true,
    },
    share_url: {
      type: String,
      default: null,
    },
    image_url: {
      type: String,
      default: null,
    },
    scraped_at: {
      type: Date,
      default: Date.now,
    },
    posted_at: {
      type: Date,
      default: null,
    },
    search_query: {
      type: String,
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: Object.values(CATEGORIES),
      default: CATEGORIES.UNCATEGORIZED,
      index: true,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    status: {
      type: String,
      enum: ["active", "archived", "flagged", "reviewed"],
      default: "active",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    engagement_data: {
      likes: { type: Number, default: 0 },
      comments: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
      reactions: { type: Number, default: 0 },
    },
    notes: {
      type: String,
      default: null,
    },
    custom_fields: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "linkedin_posts",
  },
);

linkedInPostSchema.index({ search_query: 1, scraped_at: -1 });
linkedInPostSchema.index({ author_name: 1, posted_at: -1 });
linkedInPostSchema.index({ category: 1, status: 1 });
linkedInPostSchema.index({ status: 1, priority: 1, posted_at: -1 });
linkedInPostSchema.index({ tags: 1 });

linkedInPostSchema.statics.CATEGORIES = CATEGORIES;

const LinkedInPost = mongoose.model("LinkedInPost", linkedInPostSchema);

export default LinkedInPost;
