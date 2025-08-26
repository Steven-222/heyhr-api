-- heyhr database schema
-- Compatible with MySQL 8/9

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 1) Create database (idempotent)
CREATE DATABASE IF NOT EXISTS `heyhr`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 2) Select database
USE `heyhr`;

-- 3) Tables

-- users
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NULL,
  `phone` VARCHAR(32) NULL,
  `password_hash` VARCHAR(191) NOT NULL,
  `role` ENUM('RECRUITER','CANDIDATE') NOT NULL DEFAULT 'CANDIDATE',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- applications
CREATE TABLE IF NOT EXISTS `applications` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `job_id` INT NOT NULL,
  `candidate_id` INT NOT NULL,
  `status` ENUM('APPLIED','PASSED','FAILED') NOT NULL DEFAULT 'APPLIED',
  `source` ENUM('APPLY','ADDED','REFERRED','DISCOVERED') NULL,
  `resume_url` VARCHAR(512) NULL,
  `cover_letter` TEXT NULL,
  `score` INT NULL,
  `tags` JSON NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_app_job_candidate` (`job_id`, `candidate_id`),
  KEY `idx_app_job` (`job_id`),
  KEY `idx_app_candidate` (`candidate_id`),
  KEY `idx_app_status` (`status`),
  CONSTRAINT `fk_app_job` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_app_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- interviews
CREATE TABLE IF NOT EXISTS `interviews` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `application_id` INT NOT NULL,
  `scheduled_at` DATETIME NOT NULL,
  `duration_minutes` INT NULL,
  `location` VARCHAR(255) NULL,
  `meeting_url` VARCHAR(512) NULL,
  `status` ENUM('SCHEDULED','COMPLETED','CANCELED') NOT NULL DEFAULT 'SCHEDULED',
  `feedback` TEXT NULL,
  `rating` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_int_app` (`application_id`),
  CONSTRAINT `fk_int_application` FOREIGN KEY (`application_id`) REFERENCES `applications` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- notifications
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `type` VARCHAR(50) NULL,
  `title` VARCHAR(191) NOT NULL,
  `message` TEXT NULL,
  `data` JSON NULL,
  `read_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_notif_user` (`user_id`),
  KEY `idx_notif_read` (`read_at`),
  CONSTRAINT `fk_notif_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- candidate_profiles
CREATE TABLE IF NOT EXISTS `candidate_profiles` (
  `user_id` INT NOT NULL,
  `first_name` VARCHAR(191) NULL,
  `last_name` VARCHAR(191) NULL,
  `date_of_birth` DATE NULL,
  `avatar_url` VARCHAR(512) NULL,
  `resume_url` VARCHAR(512) NULL,
  `career_objective` TEXT NULL,
  `education` JSON NULL,
  `experience` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_candidate_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- jobs
CREATE TABLE IF NOT EXISTS `jobs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `recruiter_id` INT NULL,
  `title` VARCHAR(191) NOT NULL,
  `company_name` VARCHAR(191) NULL,
  `location` VARCHAR(191) NULL,
  `remote_flexible` TINYINT(1) NOT NULL DEFAULT 0,
  `job_type` ENUM('FULL_TIME','PART_TIME','CONTRACT','INTERNSHIP','TEMPORARY','FREELANCE') NULL,
  `salary` INT NULL,
  `commencement_date` DATE NULL,
  `intro` TEXT NULL,
  `description` TEXT NULL,
  `responsibilities` JSON NULL,
  `requirements` JSON NULL,
  `qualifications` JSON NULL,
  `other_details` JSON NULL,
  `skills_soft` JSON NULL,
  `skills_technical` JSON NULL,
  `skills_cognitive` JSON NULL,
  `hiring_start_date` DATE NULL,
  `hiring_end_date` DATE NULL,
  `application_start_date` DATE NULL,
  `application_end_date` DATE NULL,
  `allow_international` TINYINT(1) NOT NULL DEFAULT 0,
  `auto_close` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('DRAFT','PUBLISHED','CLOSED') NOT NULL DEFAULT 'DRAFT',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_jobs_recruiter_id` (`recruiter_id`),
  KEY `idx_jobs_status` (`status`),
  CONSTRAINT `fk_jobs_recruiter` FOREIGN KEY (`recruiter_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- recruiter_profiles
CREATE TABLE IF NOT EXISTS `recruiter_profiles` (
  `user_id` INT NOT NULL,
  `first_name` VARCHAR(191) NULL,
  `last_name` VARCHAR(191) NULL,
  `date_of_birth` DATE NULL,
  `company_name` VARCHAR(191) NULL,
  `position` VARCHAR(191) NULL,
  `avatar_url` VARCHAR(512) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
