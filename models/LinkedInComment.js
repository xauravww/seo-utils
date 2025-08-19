import mongoose from "mongoose";

// Define the schema for LinkedIn comments
const linkedInCommentSchema = new mongoose.Schema(
  {
    // Unique identifier for the comment itself, provided by LinkedIn API
    commentId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // ID of the user from your system who made the comment
    userId: {
      type: String,
      required: true,
      index: true,
    },

    // The URN of the post that was commented on
    postId: {
      type: String,
      required: true,
      index: true,
    },

    // The text content of the generated comment
    commentText: {
      type: String,
      required: true,
    },

    // The category that was used to find the post and generate the comment
    category: {
      type: String,
      required: true,
    },

    // The public URL of the post that was commented on
    postedUrl: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
    collection: "linkedin_comments", // Explicit collection name
  },
);

// A compound index to quickly check if a user has already commented on a post
linkedInCommentSchema.index({ userId: 1, postId: 1 });

const LinkedInComment = mongoose.model(
  "LinkedInComment",
  linkedInCommentSchema,
);

export default LinkedInComment;
