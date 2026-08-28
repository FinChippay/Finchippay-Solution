data "aws_region" "current" {}

locals {
  base_url     = var.create_dns ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"
  backend_url  = "${local.base_url}/api"
  frontend_url = local.base_url
}

# ─── ECS cluster ──────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${var.name_prefix}-backend"
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/ecs/${var.name_prefix}-frontend"
  retention_in_days = 30
  tags              = var.tags
}

# ─── IAM roles ────────────────────────────────────────────────────────────────

resource "aws_iam_role" "ecs_execution" {
  name = "${var.name_prefix}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_policy" "ecs_secrets" {
  name        = "${var.name_prefix}-ecs-secrets-policy"
  description = "Allow ECS tasks to read the Finchippay application secrets."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [aws_secretsmanager_secret.app.arn]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_secrets" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = aws_iam_policy.ecs_secrets.arn
}

resource "aws_iam_role" "ecs_task" {
  name = "${var.name_prefix}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

# ─── Application secrets ──────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "app" {
  name        = "${var.name_prefix}-app-secrets"
  description = "Application secrets injected into the Finchippay ECS tasks."
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    JWT_SECRET      = var.jwt_secret
    DATABASE_URL    = var.database_url
    REDIS_URL       = var.redis_url
    ALLOWED_ORIGINS = var.allowed_origins
  })
}

# ─── Task definitions ─────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.name_prefix}-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.backend_cpu
  memory                   = var.backend_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = var.backend_image
      essential = true
      portMappings = [
        {
          containerPort = var.backend_container_port
          protocol      = "tcp"
        }
      ]
      environment = [
        { name = "PORT", value = tostring(var.backend_container_port) },
        { name = "NODE_ENV", value = "production" },
        { name = "STELLAR_NETWORK", value = var.stellar_network },
        { name = "HORIZON_URL", value = var.horizon_url },
        { name = "TURRETS_EVALUATION_INTERVAL_MS", value = var.turrets_evaluation_interval_ms },
        { name = "DB_PROVIDER", value = "postgres" }
      ]
      secrets = [
        { name = "JWT_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:JWT_SECRET::" },
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:REDIS_URL::" },
        { name = "ALLOWED_ORIGINS", valueFrom = "${aws_secretsmanager_secret.app.arn}:ALLOWED_ORIGINS::" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backend.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "backend"
        }
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_task_definition" "frontend" {
  family                   = "${var.name_prefix}-frontend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.frontend_cpu
  memory                   = var.frontend_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "frontend"
      image     = var.frontend_image
      essential = true
      portMappings = [
        {
          containerPort = var.frontend_container_port
          protocol      = "tcp"
        }
      ]
      environment = [
        { name = "NEXT_PUBLIC_STELLAR_NETWORK", value = var.stellar_network },
        { name = "NEXT_PUBLIC_HORIZON_URL", value = var.horizon_url },
        { name = "NEXT_PUBLIC_API_URL", value = local.backend_url }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.frontend.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "frontend"
        }
      }
    }
  ])

  tags = var.tags
}

# ─── Load balancer ────────────────────────────────────────────────────────────

resource "aws_lb" "main" {
  name               = "${var.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = var.environment == "prod" ? true : false

  tags = var.tags
}

resource "aws_lb_target_group" "backend" {
  name        = "${var.name_prefix}-backend-tg"
  port        = var.backend_container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 3
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    path                = "/api/health/ready"
    matcher             = "200"
  }

  tags = var.tags
}

resource "aws_lb_target_group" "frontend" {
  name        = "${var.name_prefix}-frontend-tg"
  port        = var.frontend_container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 3
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    path                = "/"
    matcher             = "200"
  }

  tags = var.tags
}

resource "aws_lb_listener" "http_redirect" {
  count             = var.create_dns ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "http_plain" {
  count             = var.create_dns ? 0 : 1
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

resource "aws_lb_listener" "https" {
  count             = var.create_dns ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

resource "aws_lb_listener_rule" "backend" {
  count        = 1
  listener_arn = var.create_dns ? aws_lb_listener.https[0].arn : aws_lb_listener.http_plain[0].arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}

# ─── ECS services ─────────────────────────────────────────────────────────────

resource "aws_ecs_service" "backend" {
  name            = "${var.name_prefix}-backend-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.backend_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.app_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = var.backend_container_port
  }

  tags = var.tags
}

resource "aws_ecs_service" "frontend" {
  name            = "${var.name_prefix}-frontend-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.frontend.arn
  desired_count   = var.frontend_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.app_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.frontend.arn
    container_name   = "frontend"
    container_port   = var.frontend_container_port
  }

  tags = var.tags
}

# ─── Autoscaling ──────────────────────────────────────────────────────────────

resource "aws_appautoscaling_target" "backend" {
  count              = var.enable_autoscaling ? 1 : 0
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.backend_min_capacity
  max_capacity       = var.backend_max_capacity
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  count              = var.enable_autoscaling ? 1 : 0
  name               = "${var.name_prefix}-backend-cpu-scaling"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.backend[0].resource_id
  scalable_dimension = "ecs:service:DesiredCount"
  policy_type        = "TargetTrackingScaling"

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "backend_memory" {
  count              = var.enable_autoscaling ? 1 : 0
  name               = "${var.name_prefix}-backend-memory-scaling"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.backend[0].resource_id
  scalable_dimension = "ecs:service:DesiredCount"
  policy_type        = "TargetTrackingScaling"

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_target" "frontend" {
  count              = var.enable_autoscaling ? 1 : 0
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.frontend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.frontend_min_capacity
  max_capacity       = var.frontend_max_capacity
}

resource "aws_appautoscaling_policy" "frontend_cpu" {
  count              = var.enable_autoscaling ? 1 : 0
  name               = "${var.name_prefix}-frontend-cpu-scaling"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.frontend[0].resource_id
  scalable_dimension = "ecs:service:DesiredCount"
  policy_type        = "TargetTrackingScaling"

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ─── DNS record (alias to ALB) ────────────────────────────────────────────────

resource "aws_route53_record" "app" {
  count   = var.create_dns ? 1 : 0
  zone_id = var.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}