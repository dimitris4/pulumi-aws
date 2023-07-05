import {Context} from "@pulumi/aws/lambda";

interface Response {
    statusCode: number;
    body: string;
}

export async function getUserProfile(ctx: Context): Promise<Response> {
    return {
        statusCode: 200,
        body: "Hello, API Gateway!",
    };
}